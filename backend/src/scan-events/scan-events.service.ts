import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { LicenseService } from '../license/license.service';
import { LocationAccessService } from '../location-access/location-access.service';
import { MailJobsService } from '../mail-jobs/mail-jobs.service';
import { PrismaService } from '../prisma.service';
import { CreateScanEventDto, ExportScanEventsDto, ListScanEventsDto } from './dto';
import {
  CreateScanEventResponse,
  ScanAction,
  ScanActionSource,
  ScanEventHistoryItem,
  ScanEventListResponse,
  ScanHistoryStatus,
} from './scan-events.types';

const MAIL_TEMPLATE_KEYS = {
  entry: 'scan_entry_notice_v1',
  exit: 'scan_exit_notice_v1',
} as const;
const SCAN_DEDUPLICATION_WINDOW_MS = 10_000;
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
const SCAN_ROUTE = 'POST:/api/scan-events';
const ACTION_CODE_PATTERN =
  /^PD1\|(ENTRY|EXIT)\|([0-9A-HJKMNP-TV-Z]{12})$/;

type ParsedActionCode = {
  personCode: string;
  action: Exclude<ScanAction, 'unknown'>;
};

type IdempotencyContext = {
  keyHash: string;
  requestFingerprint: string;
};

type ScanPersistenceClient = Pick<
  Prisma.TransactionClient,
  'mailJob' | 'scanRequestIdempotency'
>;

@Injectable()
export class ScanEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licenseService: LicenseService,
    private readonly audit: AuditService,
    private readonly mailJobs: MailJobsService,
    private readonly locationAccess: LocationAccessService,
  ) {}

  async listScanEvents(
    user: AuthenticatedUserResponse,
    query: ListScanEventsDto,
  ): Promise<ScanEventListResponse> {
    if (query.location_id) {
      await this.locationAccess.assertLocation(user, query.location_id);
    }

    const cursor = this.decodeCursor(query.cursor);
    const where: Prisma.ScanEventWhereInput = {
      tenantId: user.tenant_id,
      ...(query.location_id ? { locationId: query.location_id } : {}),
      ...(!query.location_id
        ? this.locationAccess.resourceLocationWhere(user)
        : {}),
      ...(query.created_from || query.created_to
        ? {
            createdAt: {
              ...(query.created_from ? { gte: new Date(query.created_from) } : {}),
              ...(query.created_to ? { lte: new Date(query.created_to) } : {}),
            },
          }
        : {}),
      ...(query.status === 'unmapped'
        ? { scanType: 'unmapped' }
        : query.status
          ? { mailJobs: { some: { status: query.status } } }
          : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.scanEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: this.historySelect(),
    });

    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => this.toHistoryItem(row)),
      next_cursor:
        hasMore && last
          ? this.encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  async getScanEvent(
    user: AuthenticatedUserResponse,
    scanEventId: string,
  ): Promise<ScanEventHistoryItem> {
    const row = await this.prisma.scanEvent.findFirst({
      where: {
        id: scanEventId,
        tenantId: user.tenant_id,
        ...this.locationAccess.resourceLocationWhere(user),
      },
      select: this.historySelect(),
    });

    if (!row) {
      throw new NotFoundException({
        code: 'SCAN_EVENT_NOT_FOUND',
        message: 'scan_event不存在或不属于当前租户',
      });
    }

    return this.toHistoryItem(row);
  }

  async exportScanEvents(user: AuthenticatedUserResponse, query: ExportScanEventsDto) {
    if (query.location_id) {
      await this.locationAccess.assertLocation(user, query.location_id);
    }
    const range = this.assertExportRange(query.created_from, query.created_to);
    const rows = await this.prisma.scanEvent.findMany({
      where: {
        tenantId: user.tenant_id,
        createdAt: { gte: range.from, lte: range.to },
        ...(query.location_id ? { locationId: query.location_id } : {}),
        ...(!query.location_id
          ? this.locationAccess.resourceLocationWhere(user)
          : {}),
        ...(query.status === 'unmapped'
          ? { scanType: 'unmapped' }
          : query.status ? { mailJobs: { some: { status: query.status } } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5000,
      select: this.historySelect(),
    });
    await this.audit.record({
      tenantId: user.tenant_id,
      actorUserId: user.user_id,
      action: 'scan.export',
      resourceType: 'scan_event',
      resourceId: user.tenant_id,
      result: 'success',
      metadata: { created_from: query.created_from, created_to: query.created_to, count: rows.length },
    });
    return '\uFEFF' + [
      [
        'received_at',
        'location',
        'person_code',
        'person_name',
        'action',
        'action_source',
        'status',
        'mail_job_id',
      ],
      ...rows.map((row) => {
        const item = this.toHistoryItem(row);
        return [
          item.received_at,
          item.location_name ?? '',
          item.person_code ?? item.scan_code,
          item.person_name ?? '',
          item.action,
          item.action_source,
          item.status,
          item.mail_job?.mail_job_id ?? '',
        ];
      }),
    ].map((row) => row.map((value) => this.csvCell(String(value))).join(',')).join('\r\n');
  }

  async createScanEvent(
    user: AuthenticatedUserResponse,
    dto: CreateScanEventDto,
    idempotencyKey?: string,
  ): Promise<CreateScanEventResponse> {
    let parsedCode: ParsedActionCode;
    try {
      parsedCode = this.parseActionCode(dto.scan_code);
    } catch (error) {
      await this.audit.record({
        tenantId: user.tenant_id,
        actorUserId: user.user_id,
        action: 'scan.action_code.denied',
        resourceType: 'scan_event',
        resourceId: dto.location_id,
        result: 'denied',
        metadata: { location_id: dto.location_id },
      });
      throw error;
    }

    let normalizedIdempotencyKey: string | null;
    try {
      normalizedIdempotencyKey =
        this.normalizeIdempotencyKey(idempotencyKey);
    } catch (error) {
      await this.audit.record({
        tenantId: user.tenant_id,
        actorUserId: user.user_id,
        action: 'scan.idempotency_key.denied',
        resourceType: 'scan_event',
        resourceId: dto.location_id,
        result: 'denied',
        metadata: { location_id: dto.location_id },
      });
      throw error;
    }

    const receivedAt = new Date();
    const authorizedLocation = await this.locationAccess.assertLocation(
      user,
      dto.location_id,
    );
    if (authorizedLocation.status !== 'active') {
      throw new NotFoundException({
        code: 'LOCATION_INACTIVE',
        message: 'location已停用，不能扫码',
      });
    }
    const idempotency = normalizedIdempotencyKey
      ? this.buildIdempotencyContext(
          normalizedIdempotencyKey,
          dto.location_id,
          parsedCode,
        )
      : null;

    if (idempotency) {
      const replay = await this.findIdempotentReplay(
        this.prisma,
        user.tenant_id,
        idempotency,
        receivedAt,
      );
      if (replay) {
        await this.recordScanAudit(user, replay, dto.location_id);
        return replay;
      }
    }

    const license = await this.licenseService.checkTenantLicense(user.tenant_id);
    try {
      this.licenseService.assertCanSend(license.status);
    } catch (error) {
      await this.audit.record({
        tenantId: user.tenant_id,
        actorUserId: user.user_id,
        action: 'subscription.scan.denied',
        resourceType: 'subscription',
        resourceId: user.tenant_id,
        result: 'denied',
        metadata: { status: license.status },
      });
      throw error;
    }

    const location = await this.prisma.location.findFirst({
      where: {
        ...this.locationAccess.locationWhere(user, {
          id: dto.location_id,
        }),
      },
      select: {
        id: true,
        name: true,
        status: true,
        tenant: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!location) {
      await this.locationAccess.recordDenied(user, dto.location_id);
      throw new NotFoundException({
        code: 'LOCATION_NOT_FOUND',
        message: 'location不存在或不属于当前租户',
      });
    }

    if (location.status !== 'active') {
      throw new NotFoundException({
        code: 'LOCATION_INACTIVE',
        message: 'location已停用，不能扫码',
      });
    }

    const personMapping = await this.prisma.personMapping.findFirst({
      where: {
        tenantId: user.tenant_id,
        locationId: dto.location_id,
        personCode: parsedCode.personCode,
        status: 'active',
      },
      select: {
        id: true,
        personCode: true,
        personName: true,
        email: true,
      },
    });

    const rawPayload = JSON.stringify({
      location_id: dto.location_id,
      version: 'PD1',
      person_code: parsedCode.personCode,
      action: parsedCode.action,
    });

    if (!personMapping) {
      const scanEvent = await this.prisma.$transaction(async (tx) => {
        const created = await tx.scanEvent.create({
          data: {
            tenantId: user.tenant_id,
            locationId: dto.location_id,
            personCodeSnapshot: parsedCode.personCode,
            scanCode: parsedCode.personCode,
            scanType: 'unmapped',
            action: parsedCode.action,
            actionSource: 'person_action_code',
            rawPayload,
            receivedAt,
            createdByUserId: user.user_id,
          },
          select: { id: true },
        });
        await tx.unmappedScanCase.create({
          data: {
            tenantId: user.tenant_id,
            scanEventId: created.id,
            locationId: dto.location_id,
          },
        });
        return created;
      });

      await this.audit.record({
        tenantId: user.tenant_id,
        actorUserId: user.user_id,
        action: 'scan.unmapped',
        resourceType: 'scan_event',
        resourceId: scanEvent.id,
        result: 'failure',
        metadata: { location_id: dto.location_id },
      });

      throw new NotFoundException({
        code: 'SCAN_CODE_NOT_MAPPED',
        message: 'person_code未在当前 location 找到映射邮箱',
        scan_event_id: scanEvent.id,
      });
    }

    let result: CreateScanEventResponse;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        if (idempotency) {
          await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock(hashtext($1))',
            `scan-idempotency:${user.tenant_id}:${idempotency.keyHash}`,
          );
          const replay = await this.findIdempotentReplay(
            tx,
            user.tenant_id,
            idempotency,
            receivedAt,
          );
          if (replay) {
            return replay;
          }
        }

        const lockKey = `${user.tenant_id}:${dto.location_id}:${personMapping.personCode}`;
        await tx.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          lockKey,
        );

        const duplicateAfter = new Date(
          receivedAt.getTime() - SCAN_DEDUPLICATION_WINDOW_MS,
        );
        const existing = await tx.scanEvent.findFirst({
          where: {
            tenantId: user.tenant_id,
            locationId: dto.location_id,
            personMappingId: personMapping.id,
            receivedAt: { gt: duplicateAfter },
            mailJobs: { some: {} },
          },
          orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            personCodeSnapshot: true,
            action: true,
            actionSource: true,
            mailJobs: {
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
              select: {
                id: true,
                subject: true,
                status: true,
                retryCount: true,
                scheduledAt: true,
                errorMessage: true,
              },
            },
          },
        });

        const existingMailJob = existing?.mailJobs[0];
        if (existing && existingMailJob) {
          if (existing.action !== parsedCode.action) {
            throw new ConflictException({
              code: 'SCAN_ACTION_CONFLICT',
              message: '同一人员 10 秒内已记录不同动作',
              scan_event_id: existing.id,
              existing_action: existing.action,
            });
          }

          const duplicate: CreateScanEventResponse = {
            scan_event_id: existing.id,
            mail_job_id: existingMailJob.id,
            mail_subject: existingMailJob.subject,
            person_code:
              existing.personCodeSnapshot ?? personMapping.personCode,
            action: parsedCode.action,
            action_source: existing.actionSource as ScanActionSource,
            status: existingMailJob.status as CreateScanEventResponse['status'],
            retry_count: existingMailJob.retryCount,
            scheduled_at:
              existingMailJob.scheduledAt?.toISOString() ?? null,
            error_message: existingMailJob.errorMessage,
            deduplicated: true,
          };
          await this.storeIdempotency(
            tx,
            user.tenant_id,
            idempotency,
            duplicate,
            receivedAt,
          );
          return duplicate;
        }

        const scanEvent = await tx.scanEvent.create({
          data: {
            tenantId: user.tenant_id,
            locationId: dto.location_id,
            personMappingId: personMapping.id,
            personCodeSnapshot: personMapping.personCode,
            scanCode: personMapping.personCode,
            scanType: parsedCode.action,
            action: parsedCode.action,
            actionSource: 'person_action_code',
            rawPayload,
            receivedAt,
            createdByUserId: user.user_id,
          },
          select: { id: true },
        });

        const mailSubject = `${location.name}からのお知らせ`;
        const mailBody = this.buildMailBody({
          tenantName: location.tenant.name,
          locationName: location.name,
          personName: personMapping.personName,
          timestamp: this.formatUtcTimestamp(receivedAt),
          action: parsedCode.action,
        });

        const mailJob = await tx.mailJob.create({
          data: {
            tenantId: user.tenant_id,
            locationId: location.id,
            personMappingId: personMapping.id,
            scanEventId: scanEvent.id,
            tenantNameSnapshot: location.tenant.name,
            locationNameSnapshot: location.name,
            personNameSnapshot: personMapping.personName,
            personCodeSnapshot: personMapping.personCode,
            actionSnapshot: parsedCode.action,
            contextSnapshotSource: 'scan_relation',
            toEmail: personMapping.email,
            subject: mailSubject,
            body: mailBody,
            templateKey: MAIL_TEMPLATE_KEYS[parsedCode.action],
            status: 'queued',
          },
          select: { id: true },
        });

        const created: CreateScanEventResponse = {
          scan_event_id: scanEvent.id,
          mail_job_id: mailJob.id,
          mail_subject: mailSubject,
          person_code: personMapping.personCode,
          action: parsedCode.action,
          action_source: 'person_action_code',
          status: 'queued',
          retry_count: 0,
          scheduled_at: null,
          error_message: null,
          deduplicated: false,
        };
        await this.storeIdempotency(
          tx,
          user.tenant_id,
          idempotency,
          created,
          receivedAt,
        );
        return created;
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        await this.audit.record({
          tenantId: user.tenant_id,
          actorUserId: user.user_id,
          action: 'scan.action.conflict',
          resourceType: 'scan_event',
          resourceId: dto.location_id,
          result: 'denied',
          metadata: {
            location_id: dto.location_id,
            action: parsedCode.action,
          },
        });
      }
      throw error;
    }

    await this.recordScanAudit(user, result, dto.location_id);
    if (result.deduplicated) {
      return result;
    }

    const delivery = await this.mailJobs.processQueuedMailJob(
      user.tenant_id,
      result.mail_job_id,
      user.user_id,
    );
    return {
      ...result,
      status: delivery.status,
      retry_count: delivery.retry_count,
      scheduled_at: delivery.scheduled_at,
      error_message: delivery.provider_result.error_message ?? null,
    };
  }

  private parseActionCode(value: string): ParsedActionCode {
    const raw = value.trim();
    const match = ACTION_CODE_PATTERN.exec(raw);
    if (!match) {
      throw new BadRequestException({
        code: 'ACTION_CODE_INVALID',
        message:
          '动作码格式无效，应为 PD1|ENTRY|<person_code> 或 PD1|EXIT|<person_code>',
      });
    }

    return {
      action: match[1] === 'ENTRY' ? 'entry' : 'exit',
      personCode: match[2],
    };
  }

  private normalizeIdempotencyKey(value?: string): string | null {
    if (value === undefined) {
      return null;
    }
    const normalized = value.trim();
    if (!/^[!-~]{8,200}$/.test(normalized)) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_INVALID',
        message: 'Idempotency-Key 必须为 8–200 位可见 ASCII 字符',
      });
    }
    return normalized;
  }

  private buildIdempotencyContext(
    key: string,
    locationId: string,
    parsedCode: ParsedActionCode,
  ): IdempotencyContext {
    return {
      keyHash: this.sha256(key),
      requestFingerprint: this.sha256(
        JSON.stringify({
          location_id: locationId,
          person_code: parsedCode.personCode,
          action: parsedCode.action,
        }),
      ),
    };
  }

  private async findIdempotentReplay(
    client: ScanPersistenceClient,
    tenantId: string,
    idempotency: IdempotencyContext,
    now: Date,
  ): Promise<CreateScanEventResponse | null> {
    const record = await client.scanRequestIdempotency.findFirst({
      where: {
        tenantId,
        route: SCAN_ROUTE,
        keyHash: idempotency.keyHash,
        expiresAt: { gt: now },
      },
      select: {
        requestFingerprint: true,
        mailJobId: true,
      },
    });
    if (!record) {
      return null;
    }
    if (record.requestFingerprint !== idempotency.requestFingerprint) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'Idempotency-Key 已用于不同的扫码请求',
      });
    }

    const mailJob = await client.mailJob.findFirst({
      where: { id: record.mailJobId, tenantId },
      select: {
        id: true,
        subject: true,
        status: true,
        retryCount: true,
        scheduledAt: true,
        errorMessage: true,
        actionSnapshot: true,
        scanEvent: {
          select: {
            id: true,
            personCodeSnapshot: true,
            action: true,
            actionSource: true,
          },
        },
      },
    });
    if (!mailJob) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_RESULT_NOT_FOUND',
        message: '幂等记录对应的扫码结果不存在',
      });
    }
    if (
      mailJob.scanEvent.action === 'unknown' ||
      mailJob.actionSnapshot !== mailJob.scanEvent.action
    ) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_RESULT_INVALID',
        message: '幂等记录对应的扫码与邮件动作不一致',
      });
    }

    return {
      scan_event_id: mailJob.scanEvent.id,
      mail_job_id: mailJob.id,
      mail_subject: mailJob.subject,
      person_code: mailJob.scanEvent.personCodeSnapshot ?? '',
      action: mailJob.scanEvent.action as Exclude<ScanAction, 'unknown'>,
      action_source: mailJob.scanEvent.actionSource as ScanActionSource,
      status: mailJob.status as CreateScanEventResponse['status'],
      retry_count: mailJob.retryCount,
      scheduled_at: mailJob.scheduledAt?.toISOString() ?? null,
      error_message: this.safeFailureMessage(mailJob.errorMessage),
      deduplicated: true,
    };
  }

  private async storeIdempotency(
    tx: Prisma.TransactionClient,
    tenantId: string,
    idempotency: IdempotencyContext | null,
    result: CreateScanEventResponse,
    now: Date,
  ): Promise<void> {
    if (!idempotency) {
      return;
    }
    await tx.scanRequestIdempotency.upsert({
      where: {
        tenantId_route_keyHash: {
          tenantId,
          route: SCAN_ROUTE,
          keyHash: idempotency.keyHash,
        },
      },
      create: {
        tenantId,
        route: SCAN_ROUTE,
        keyHash: idempotency.keyHash,
        requestFingerprint: idempotency.requestFingerprint,
        scanEventId: result.scan_event_id,
        mailJobId: result.mail_job_id,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
      },
      update: {
        requestFingerprint: idempotency.requestFingerprint,
        scanEventId: result.scan_event_id,
        mailJobId: result.mail_job_id,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
        createdAt: now,
      },
    });
  }

  private async recordScanAudit(
    user: AuthenticatedUserResponse,
    result: CreateScanEventResponse,
    locationId: string,
  ): Promise<void> {
    await this.audit.record({
      tenantId: user.tenant_id,
      actorUserId: user.user_id,
      action: result.deduplicated ? 'scan.deduplicated' : 'scan.created',
      resourceType: 'scan_event',
      resourceId: result.scan_event_id,
      result: 'success',
      metadata: {
        location_id: locationId,
        mail_job_id: result.mail_job_id,
        action: result.action,
        action_source: result.action_source,
      },
    });
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private buildMailBody(input: {
    tenantName: string;
    locationName: string;
    personName: string;
    timestamp: string;
    action: Exclude<ScanAction, 'unknown'>;
  }): string {
    const actionText = input.action === 'entry' ? '入室' : '退室';
    return `${input.tenantName}，${input.locationName}からのお知らせ：${input.personName}　さんは　${input.timestamp}　に${actionText}しました。`;
  }

  private formatUtcTimestamp(value: Date): string {
    return value.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  }

  private historySelect() {
    return {
      id: true,
      locationId: true,
      personCodeSnapshot: true,
      scanCode: true,
      scanType: true,
      action: true,
      actionSource: true,
      receivedAt: true,
      createdAt: true,
      location: { select: { name: true } },
      mailJobs: {
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        take: 1,
        select: {
          id: true,
          status: true,
          sentAt: true,
          errorMessage: true,
          locationNameSnapshot: true,
          personNameSnapshot: true,
          personCodeSnapshot: true,
          actionSnapshot: true,
        },
      },
    };
  }

  private toHistoryItem(row: {
    id: string;
    locationId: string | null;
    personCodeSnapshot: string | null;
    scanCode: string;
    scanType: string;
    action: string;
    actionSource: string;
    receivedAt: Date;
    location: { name: string } | null;
    mailJobs: Array<{
      id: string;
      status: string;
      sentAt: Date | null;
      errorMessage: string | null;
      locationNameSnapshot: string;
      personNameSnapshot: string;
      personCodeSnapshot: string;
      actionSnapshot: string;
    }>;
  }): ScanEventHistoryItem {
    const mailJob = row.mailJobs[0] ?? null;
    const status: ScanHistoryStatus =
      row.scanType === 'unmapped'
        ? 'unmapped'
        : (mailJob?.status as ScanHistoryStatus | undefined) ?? 'queued';

    return {
      scan_event_id: row.id,
      location_id: row.locationId,
      location_name:
        mailJob?.locationNameSnapshot ?? row.location?.name ?? null,
      person_code:
        mailJob?.personCodeSnapshot ?? row.personCodeSnapshot,
      person_name: mailJob?.personNameSnapshot ?? null,
      scan_code: row.scanCode,
      scan_type: row.scanType,
      action: row.action as ScanAction,
      action_source: row.actionSource as ScanActionSource,
      received_at: row.receivedAt.toISOString(),
      status,
      mail_job: mailJob
        ? {
            mail_job_id: mailJob.id,
            status: mailJob.status,
            action: mailJob.actionSnapshot as ScanAction,
            sent_at: mailJob.sentAt?.toISOString() ?? null,
            error_message: this.safeFailureMessage(mailJob.errorMessage),
          }
        : null,
    };
  }

  private safeFailureMessage(message: string | null): string | null {
    if (!message) {
      return null;
    }
    return message === 'Sandbox provider simulated failure'
      ? message
      : '邮件发送失败';
  }

  private encodeCursor(createdAt: Date, id: string) {
    return Buffer.from(
      JSON.stringify({ created_at: createdAt.toISOString(), id }),
    ).toString('base64url');
  }

  private decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
    if (!cursor) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as { created_at?: unknown; id?: unknown };
      const createdAt = new Date(String(parsed.created_at ?? ''));
      if (
        Number.isNaN(createdAt.getTime()) ||
        typeof parsed.id !== 'string' ||
        !parsed.id
      ) {
        throw new Error('invalid cursor');
      }
      return { createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException({
        code: 'INVALID_CURSOR',
        message: 'cursor无效',
      });
    }
  }

  private assertExportRange(createdFrom: string, createdTo: string) {
    const from = new Date(createdFrom);
    const to = new Date(createdTo);
    if (from > to || to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException({ code: 'INVALID_EXPORT_RANGE', message: '导出时间范围必须为 31 天以内' });
    }
    return { from, to };
  }

  private csvCell(value: string) {
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }

}
