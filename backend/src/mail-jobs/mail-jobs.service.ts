import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUserResponse } from '../auth/auth.types';
import { LicenseService } from '../license/license.service';
import { LocationAccessService } from '../location-access/location-access.service';
import { PrismaService } from '../prisma.service';
import { SandboxMailProvider } from './sandbox-mail.provider';
import { ExportMailJobsDto, ListMailJobsDto } from './dto';
import {
  MailJobHistoryItem,
  MailJobListResponse,
  SendMailJobResponse,
} from './mail-jobs.types';

@Injectable()
export class MailJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly licenseService: LicenseService,
    private readonly mailProvider: SandboxMailProvider,
    private readonly audit: AuditService,
    private readonly locationAccess: LocationAccessService,
  ) {}

  async listMailJobs(
    user: AuthenticatedUserResponse,
    query: ListMailJobsDto,
  ): Promise<MailJobListResponse> {
    const selectedLocation = query.location_id
      ? await this.locationAccess.assertLocation(user, query.location_id, true)
      : null;

    const cursor = this.decodeCursor(query.cursor);
    const where: Prisma.MailJobWhereInput = {
      tenantId: user.tenant_id,
      ...(query.status ? { status: query.status } : {}),
      ...(selectedLocation ? { locationId: selectedLocation.id } : {}),
      ...(!query.location_id
        ? this.locationAccess.resourceLocationWhere(user, true)
        : {}),
      ...(query.created_from || query.created_to
        ? {
            createdAt: {
              ...(query.created_from ? { gte: new Date(query.created_from) } : {}),
              ...(query.created_to ? { lte: new Date(query.created_to) } : {}),
            },
          }
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

    const rows = await this.prisma.mailJob.findMany({
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

  async getMailJob(
    user: AuthenticatedUserResponse,
    mailJobId: string,
  ): Promise<MailJobHistoryItem> {
    const row = await this.prisma.mailJob.findFirst({
      where: {
        id: mailJobId,
        tenantId: user.tenant_id,
        ...this.locationAccess.resourceLocationWhere(user, true),
      },
      select: this.historySelect(),
    });
    if (!row) {
      throw new NotFoundException({
        code: 'MAIL_JOB_NOT_FOUND',
        message: 'mail_job不存在或不属于当前租户',
      });
    }
    return this.toHistoryItem(row);
  }

  async exportMailJobs(user: AuthenticatedUserResponse, query: ExportMailJobsDto) {
    const selectedLocation = query.location_id
      ? await this.locationAccess.assertLocation(user, query.location_id, true)
      : null;
    const range = this.assertExportRange(query.created_from, query.created_to);
    const rows = await this.prisma.mailJob.findMany({
      where: {
        tenantId: user.tenant_id,
        createdAt: { gte: range.from, lte: range.to },
        ...(query.status ? { status: query.status } : {}),
        ...(selectedLocation ? { locationId: selectedLocation.id } : {}),
        ...(!query.location_id
          ? this.locationAccess.resourceLocationWhere(user, true)
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5000,
      select: { ...this.historySelect(), toEmail: true },
    });
    await this.audit.record({
      tenantId: user.tenant_id,
      actorUserId: user.user_id,
      action: 'mail.export',
      resourceType: 'mail_job',
      resourceId: user.tenant_id,
      result: 'success',
      metadata: { created_from: query.created_from, created_to: query.created_to, count: rows.length },
    });
    return '\uFEFF' + [
      [
        'created_at',
        'mail_job_id',
        'tenant',
        'location',
        'person_name',
        'person_code',
        'action',
        'email_masked',
        'status',
        'sent_at',
      ],
      ...rows.map((row) => [
        row.createdAt.toISOString(),
        row.id,
        row.tenantNameSnapshot,
        row.locationNameSnapshot,
        row.personNameSnapshot,
        row.personCodeSnapshot,
        row.actionSnapshot,
        this.maskEmail(row.toEmail),
        row.status,
        row.sentAt?.toISOString() ?? '',
      ]),
    ].map((row) => row.map((value) => this.csvCell(String(value))).join(',')).join('\r\n');
  }

  async sendMailJob(
    user: AuthenticatedUserResponse,
    mailJobId: string,
  ): Promise<SendMailJobResponse> {
    const authorized = await this.prisma.mailJob.findFirst({
      where: {
        id: mailJobId,
        tenantId: user.tenant_id,
        ...this.locationAccess.resourceLocationWhere(user),
      },
      select: { id: true },
    });
    if (!authorized) {
      await this.audit.record({
        tenantId: user.tenant_id,
        actorUserId: user.user_id,
        action: 'authorization.mail_job.denied',
        resourceType: 'mail_job',
        resourceId: mailJobId,
        result: 'denied',
      });
      throw new NotFoundException({
        code: 'MAIL_JOB_NOT_FOUND',
        message: 'mail_job不存在或不属于当前租户',
      });
    }
    return this.processQueuedMailJob(
      user.tenant_id,
      mailJobId,
      user.user_id,
    );
  }

  async processQueuedMailJob(
    tenantId: string,
    mailJobId: string,
    actorUserId: string | null,
  ): Promise<SendMailJobResponse> {
    return this.processClaimedMailJob(tenantId, mailJobId, actorUserId);
  }

  private async processClaimedMailJob(
    tenantId: string,
    mailJobId: string,
    actorUserId: string | null,
  ): Promise<SendMailJobResponse> {
    const attemptId = randomUUID();
    const mailJob = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$executeRawUnsafe(
        `UPDATE "mail_jobs"
         SET "status" = 'processing', "claimed_at" = CURRENT_TIMESTAMP,
             "claim_attempt_id" = $1::uuid, "updated_at" = CURRENT_TIMESTAMP
         WHERE "id" = $2::uuid AND "tenant_id" = $3::uuid
           AND (
             ($4::boolean AND "status" = 'waiting' AND CURRENT_TIMESTAMP >= "send_not_before")
             OR ("status" = 'queued' AND "scheduled_at" IS NOT NULL AND CURRENT_TIMESTAMP >= "scheduled_at")
             OR ("status" = 'queued' AND "scheduled_at" IS NULL AND "send_not_before" IS NULL)
           )`,
        attemptId,
        mailJobId,
        tenantId,
        actorUserId === null,
      );
      if (claimed !== 1) return null;
      await tx.mailDeliveryAttempt.create({
        data: { id: attemptId, tenantId, mailJobId, status: 'claimed' },
      });
      return tx.mailJob.findFirstOrThrow({
        where: { id: mailJobId, tenantId, status: 'processing', claimAttemptId: attemptId },
        select: {
          id: true,
          toEmail: true,
          subject: true,
          body: true,
          retryCount: true,
          location: { select: { status: true } },
          personMapping: { select: { status: true } },
        },
      });
    });

    if (!mailJob) {
      const current = await this.prisma.mailJob.findFirst({
        where: { id: mailJobId, tenantId },
        select: { id: true, status: true, scheduledAt: true, sendNotBefore: true },
      });
      if (!current) {
        throw new NotFoundException({
          code: 'MAIL_JOB_NOT_FOUND',
          message: 'mail_job does not exist in this tenant',
        });
      }
      if (current.status === 'sent') {
        throw new ConflictException({ code: 'MAIL_JOB_ALREADY_SENT', message: 'mail_job was already sent' });
      }
      throw new ConflictException({
        code: 'MAIL_JOB_STATUS_NOT_SENDABLE',
        message: 'mail_job is not due or is in a terminal state',
      });
    }

    const license = await this.licenseService.checkTenantLicense(tenantId);
    try {
      this.licenseService.assertCanSend(license.status);
    } catch {
      return this.blockClaimedJob(tenantId, mailJob.id, attemptId, actorUserId, mailJob.retryCount, 'SUBSCRIPTION_NOT_SENDABLE');
    }
    if (mailJob.location.status !== 'active' || mailJob.personMapping.status !== 'active') {
      return this.blockClaimedJob(tenantId, mailJob.id, attemptId, actorUserId, mailJob.retryCount, 'RESOURCE_NOT_SENDABLE');
    }

    await this.prisma.mailDeliveryAttempt.update({
      where: { id: attemptId },
      data: { status: 'invoked', providerInvokedAt: new Date() },
    });

    let providerResult;
    try {
      providerResult = await this.mailProvider.send({
        mailJobId: mailJob.id,
        attemptId,
        toEmail: mailJob.toEmail,
        subject: mailJob.subject,
        body: mailJob.body,
      });
    } catch {
      providerResult = { provider: 'sandbox', success: false, errorMessage: 'Sandbox provider request failed' };
    }

    if (providerResult.success) {
      const completedAt = new Date();
      await this.prisma.$transaction([
        this.prisma.mailJob.update({
          where: { id: mailJob.id },
          data: {
            status: 'sent',
            providerMessageId: providerResult.providerMessageId,
            errorMessage: null,
            scheduledAt: null,
            sentAt: completedAt,
          },
        }),
        this.prisma.mailDeliveryAttempt.update({
          where: { id: attemptId },
          data: {
            status: 'succeeded',
            completedAt,
            providerMessageId: providerResult.providerMessageId,
          },
        }),
      ]);
      await this.audit.record({
        tenantId,
        actorUserId,
        action: 'mail.send',
        resourceType: 'mail_job',
        resourceId: mailJob.id,
        result: 'success',
        metadata: { provider: providerResult.provider, attempt_id: attemptId },
      });
      return {
        mail_job_id: mailJob.id,
        status: 'sent',
        retry_count: mailJob.retryCount,
        scheduled_at: null,
        provider_result: {
          provider: providerResult.provider,
          success: true,
          provider_message_id: providerResult.providerMessageId,
        },
      };
    }

    const retryDelaysMs = [30_000, 120_000, 600_000];
    const retryDelayMs = retryDelaysMs[mailJob.retryCount];
    const nextRetryCount = mailJob.retryCount + 1;
    const scheduledAt = retryDelayMs === undefined ? null : new Date(Date.now() + retryDelayMs);
    const terminal = scheduledAt === null;
    const completedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.mailJob.update({
        where: { id: mailJob.id },
        data: {
          status: terminal ? 'failed' : 'queued',
          retryCount: nextRetryCount,
          scheduledAt,
          errorMessage: providerResult.errorMessage,
          providerMessageId: providerResult.providerMessageId,
        },
      }),
      this.prisma.mailDeliveryAttempt.update({
        where: { id: attemptId },
        data: {
          status: terminal ? 'failed' : 'retry_scheduled',
          completedAt,
          providerMessageId: providerResult.providerMessageId,
          errorCode: 'PROVIDER_FAILURE',
        },
      }),
    ]);
    await this.audit.record({
      tenantId,
      actorUserId,
      action: terminal ? 'mail.retry.exhausted' : 'mail.retry.scheduled',
      resourceType: 'mail_job',
      resourceId: mailJob.id,
      result: 'failure',
      metadata: {
        provider: providerResult.provider,
        reason: 'PROVIDER_FAILURE',
        retry_count: nextRetryCount,
        scheduled_at: scheduledAt?.toISOString() ?? null,
        attempt_id: attemptId,
      },
    });
    return this.failureResponse(
      mailJob.id,
      nextRetryCount,
      scheduledAt,
      providerResult.errorMessage ?? 'Sandbox provider request failed',
      providerResult.providerMessageId,
      terminal ? 'failed' : 'queued',
    );
  }

  private async blockClaimedJob(
    tenantId: string,
    mailJobId: string,
    attemptId: string,
    actorUserId: string | null,
    retryCount: number,
    errorCode: 'SUBSCRIPTION_NOT_SENDABLE' | 'RESOURCE_NOT_SENDABLE',
  ): Promise<SendMailJobResponse> {
    const completedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.mailJob.update({
        where: { id: mailJobId },
        data: { status: 'failed', scheduledAt: null, errorMessage: errorCode },
      }),
      this.prisma.mailDeliveryAttempt.update({
        where: { id: attemptId },
        data: { status: 'blocked', completedAt, errorCode },
      }),
    ]);
    await this.audit.record({
      tenantId,
      actorUserId,
      action: errorCode === 'SUBSCRIPTION_NOT_SENDABLE' ? 'subscription.mail_send.denied' : 'resource.mail_send.denied',
      resourceType: 'mail_job',
      resourceId: mailJobId,
      result: 'denied',
      metadata: { reason: errorCode, attempt_id: attemptId },
    });
    return this.failureResponse(mailJobId, retryCount, null, errorCode);
  }

  async recoverStaleProcessingJobs(staleBefore: Date): Promise<number> {
    const stale = await this.prisma.mailJob.findMany({
      where: { status: 'processing', claimedAt: { lte: staleBefore } },
      select: { id: true, tenantId: true, claimAttemptId: true, retryCount: true, sendNotBefore: true },
      take: 20,
      orderBy: [{ claimedAt: 'asc' }, { id: 'asc' }],
    });
    for (const job of stale) {
      const attempt = job.claimAttemptId
        ? await this.prisma.mailDeliveryAttempt.findUnique({
            where: { id: job.claimAttemptId },
            select: { providerInvokedAt: true, completedAt: true },
          })
        : null;
      if (attempt?.completedAt) continue;
      if (!job.claimAttemptId || attempt?.providerInvokedAt) {
        await this.prisma.mailJob.updateMany({
          where: { id: job.id, tenantId: job.tenantId, status: 'processing' },
          data: { status: 'delivery_unknown', errorMessage: 'PROVIDER_OUTCOME_UNKNOWN' },
        });
        if (job.claimAttemptId) {
          await this.prisma.mailDeliveryAttempt.update({
            where: { id: job.claimAttemptId },
            data: { status: 'delivery_unknown', completedAt: new Date(), errorCode: 'PROVIDER_OUTCOME_UNKNOWN' },
          });
        }
      } else {
        await this.prisma.mailJob.updateMany({
          where: { id: job.id, tenantId: job.tenantId, status: 'processing', claimAttemptId: job.claimAttemptId },
          data: {
            status: job.retryCount === 0 && job.sendNotBefore ? 'waiting' : 'queued',
            claimedAt: null,
            claimAttemptId: null,
            errorMessage: null,
          },
        });
        await this.prisma.mailDeliveryAttempt.update({
          where: { id: job.claimAttemptId },
          data: { status: 'abandoned', completedAt: new Date(), errorCode: 'STALE_BEFORE_PROVIDER' },
        });
      }
    }
    return stale.length;
  }

  private historySelect() {
    return {
      id: true,
      locationId: true,
      status: true,
      createdAt: true,
      sentAt: true,
      errorMessage: true,
      retryCount: true,
      scheduledAt: true,
      cancelUntil: true,
      sendNotBefore: true,
      claimedAt: true,
      tenantNameSnapshot: true,
      locationNameSnapshot: true,
      personNameSnapshot: true,
      personCodeSnapshot: true,
      actionSnapshot: true,
      contextSnapshotSource: true,
      location: { select: { locationCode: true } },
      scanEvent: {
        select: {
          id: true,
          scanCode: true,
          action: true,
          actionSource: true,
          receivedAt: true,
        },
      },
    };
  }

  private toHistoryItem(row: {
    id: string;
    status: string;
    createdAt: Date;
    sentAt: Date | null;
    errorMessage: string | null;
    retryCount: number;
    scheduledAt: Date | null;
    cancelUntil: Date | null;
    sendNotBefore: Date | null;
    claimedAt: Date | null;
    tenantNameSnapshot: string;
    locationNameSnapshot: string;
    personNameSnapshot: string;
    personCodeSnapshot: string;
    actionSnapshot: string;
    contextSnapshotSource: string;
    locationId: string;
    location: { locationCode: string };
    scanEvent: {
      id: string;
      scanCode: string;
      action: string;
      actionSource: string;
      receivedAt: Date;
    };
  }): MailJobHistoryItem {
    return {
      mail_job_id: row.id,
      action: row.actionSnapshot as MailJobHistoryItem['action'],
      status: row.status,
      created_at: row.createdAt.toISOString(),
      sent_at: row.sentAt?.toISOString() ?? null,
      error_message: this.safeFailureMessage(row.errorMessage),
      retry_count: row.retryCount,
      scheduled_at: row.scheduledAt?.toISOString() ?? null,
      cancel_until: row.cancelUntil?.toISOString() ?? null,
      send_not_before: row.sendNotBefore?.toISOString() ?? null,
      claimed_at: row.claimedAt?.toISOString() ?? null,
      context: {
        tenant_name: row.tenantNameSnapshot,
        location_name: row.locationNameSnapshot,
        person_name: row.personNameSnapshot,
        person_code: row.personCodeSnapshot,
        snapshot_source: row.contextSnapshotSource,
      },
      scan_event: {
        scan_event_id: row.scanEvent.id,
        location_id: row.location.locationCode,
        location_name: row.locationNameSnapshot,
        person_code: row.personCodeSnapshot,
        action: row.scanEvent.action as MailJobHistoryItem['scan_event']['action'],
        action_source:
          row.scanEvent.actionSource as MailJobHistoryItem['scan_event']['action_source'],
        scan_code: row.scanEvent.scanCode,
        received_at: row.scanEvent.receivedAt.toISOString(),
      },
    };
  }

  private failureResponse(
    mailJobId: string,
    retryCount: number,
    scheduledAt: Date | null,
    errorMessage: string,
    providerMessageId?: string,
    status: 'queued' | 'failed' = 'failed',
  ): SendMailJobResponse {
    return {
      mail_job_id: mailJobId,
      status,
      retry_count: retryCount,
      scheduled_at: scheduledAt?.toISOString() ?? null,
      provider_result: {
        provider: 'sandbox',
        success: false,
        provider_message_id: providerMessageId,
        error_message: errorMessage,
      },
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

  private maskEmail(email: string) {
    const [local, domain] = email.split('@');
    if (!domain) return '[redacted-email]';
    if (local.length <= 1) return `${local}***@${domain}`;
    return `${local[0]}***${local.at(-1)}@${domain}`;
  }

  private csvCell(value: string) {
    const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  }
}
