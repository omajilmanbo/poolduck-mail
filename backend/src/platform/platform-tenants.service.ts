import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  createHash,
  createHmac,
} from 'node:crypto';
import { PrismaService } from '../prisma.service';
import {
  generateTenantCode,
  TENANT_CODE_MAX_ATTEMPTS,
} from '../tenants/tenant-code.generator';
import {
  CreatePlatformTenantDto,
  DeletePlatformTenantDto,
  UpdateLocationLimitDto,
  UpdateSubscriptionDto,
} from './platform.dto';
import { AuthenticatedPlatformAdmin } from './platform.types';
import { PlatformAuditService } from './platform-audit.service';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  async listTenants() {
    const tenants = await this.prisma.tenant.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: this.tenantSelect(),
    });
    return tenants.map((tenant) => this.presentTenant(tenant));
  }

  async getTenant(tenantCode: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { tenantCode: tenantCode.trim().toUpperCase() },
      select: this.tenantSelect(),
    });
    if (!tenant) throw this.notFound();
    return this.presentTenant(tenant);
  }

  async createTenant(
    admin: AuthenticatedPlatformAdmin,
    idempotencyKey: string | undefined,
    dto: CreatePlatformTenantDto,
    requestId?: string,
  ) {
    const key = idempotencyKey?.trim();
    if (!key || key.length > 255) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '需要有效的 Idempotency-Key',
      });
    }
    const secret = this.provisioningSecret();
    const startAt = new Date(dto.start_at);
    const endAt = new Date(dto.end_at);
    if (endAt <= startAt || endAt <= new Date()) {
      throw new BadRequestException({
        code: 'INVALID_SUBSCRIPTION_INTERVAL',
        message: 'trial/active 的 end_at 必须晚于 start_at 和当前时间',
      });
    }

    const normalized = {
      name: dto.name.trim(),
      manager_email: dto.manager_email.trim().toLowerCase(),
      subscription_status: dto.subscription_status,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      location_limit: dto.location_limit,
    };
    const keyHash = this.sha256(key);
    const fingerprint = this.sha256(JSON.stringify(normalized));
    const temporaryPassword = this.deriveTemporaryPassword(
      secret,
      keyHash,
      fingerprint,
    );
    const passwordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id,
    });

    for (
      let attempt = 1;
      attempt <= TENANT_CODE_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const tenantCode = generateTenantCode();
      try {
        const result = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))`,
          );
          const existing = await tx.platformTenantIdempotency.findUnique({
            where: { keyHash },
            select: {
              requestFingerprint: true,
              platformAdminId: true,
              tenant: { select: this.tenantSelect() },
            },
          });
          if (existing) {
            if (
              existing.requestFingerprint !== fingerprint ||
              existing.platformAdminId !== admin.platform_admin_id
            ) {
              throw new ConflictException({
                code: 'IDEMPOTENCY_KEY_CONFLICT',
                message: 'Idempotency-Key 已用于不同请求',
              });
            }
            return {
              tenant: existing.tenant,
              replayed: true,
            };
          }

          const tenant = await tx.tenant.create({
            data: {
              tenantCode,
              name: normalized.name,
              status: 'active',
              locationLimit: normalized.location_limit,
              platformVersion: 1,
              subscription: {
                create: {
                  plan: 'manual',
                  status: normalized.subscription_status,
                  startAt,
                  endAt,
                },
              },
              users: {
                create: {
                  email: normalized.manager_email,
                  username: null,
                  passwordHash,
                  role: 'tenant_manager',
                  status: 'active',
                  mustChangePassword: true,
                },
              },
            },
            select: this.tenantSelect(),
          });
          await tx.platformTenantIdempotency.create({
            data: {
              keyHash,
              requestFingerprint: fingerprint,
              platformAdminId: admin.platform_admin_id,
              tenantId: tenant.id,
              expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
            },
          });
          return { tenant, replayed: false };
        });

        await this.audit.record({
          platformAdminId: admin.platform_admin_id,
          targetTenantId: result.tenant.id,
          requestId,
          action: 'platform.tenant.create',
          resourceType: 'tenant',
          resourceId: result.tenant.id,
          result: 'success',
          metadata: {
            replayed: result.replayed,
            tenant_code: result.tenant.tenantCode,
            location_limit: result.tenant.locationLimit,
          },
        });
        return {
          ...this.presentTenant(result.tenant),
          temporary_password: temporaryPassword,
          idempotency_replayed: result.replayed,
        };
      } catch (error) {
        if (
          this.isTenantCodeConflict(error) &&
          attempt < TENANT_CODE_MAX_ATTEMPTS
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ServiceUnavailableException({
      code: 'TENANT_CODE_GENERATION_EXHAUSTED',
      message: 'tenant_code 生成失败，请稍后重试',
    });
  }

  async updateSubscription(
    admin: AuthenticatedPlatformAdmin,
    tenantCode: string,
    dto: UpdateSubscriptionDto,
    requestId?: string,
  ) {
    const startAt = new Date(dto.start_at);
    const endAt = new Date(dto.end_at);
    if (endAt <= startAt) {
      throw new BadRequestException({
        code: 'INVALID_SUBSCRIPTION_INTERVAL',
        message: 'end_at 必须晚于 start_at',
      });
    }
    const tenant = await this.findTenantIdentity(tenantCode);
    if (
      (dto.status === 'trial' || dto.status === 'active') &&
      endAt <= new Date()
    ) {
      throw new BadRequestException({
        code: 'INVALID_SUBSCRIPTION_INTERVAL',
        message: 'trial/active 的 end_at 必须晚于当前时间',
      });
    }
    if (dto.status === 'expired' && endAt > new Date()) {
      throw new BadRequestException({
        code: 'EXPIRED_SUBSCRIPTION_END_IN_FUTURE',
        message: 'expired 的 end_at 不能晚于当前时间',
      });
    }
    const current = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>(
        Prisma.sql`SELECT id, status FROM tenants WHERE id = ${tenant.id}::uuid FOR UPDATE`,
      );
      if (!locked[0]) throw this.notFound();
      if (locked[0].status === 'pending_delete' || locked[0].status === 'purged') {
        throw this.deletionConflict();
      }
      const subscription = await tx.subscription.findUnique({
        where: { tenantId: tenant.id },
      });
      if (!subscription) throw this.notFound();
      if (
        dto.status === 'suspended' &&
        (startAt.getTime() !== subscription.startAt.getTime() ||
          endAt.getTime() !== subscription.endAt.getTime())
      ) {
        throw new BadRequestException({
          code: 'SUSPENSION_INTERVAL_MUST_BE_PRESERVED',
          message: '暂停时必须保留原订阅时间区间',
        });
      }
      const updated = await tx.subscription.updateMany({
        where: { tenantId: tenant.id, version: dto.version },
        data: {
          status: dto.status,
          startAt,
          endAt,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw this.versionConflict();
      return subscription;
    });
    await this.audit.record({
      platformAdminId: admin.platform_admin_id,
      targetTenantId: tenant.id,
      requestId,
      action: 'platform.subscription.update',
      resourceType: 'subscription',
      resourceId: current.id,
      result: 'success',
      metadata: {
        old_status: current.status,
        new_status: dto.status,
        old_version: current.version,
        new_version: current.version + 1,
      },
    });
    return this.getTenant(tenant.tenantCode);
  }

  async deleteTenant(
    admin: AuthenticatedPlatformAdmin,
    tenantCode: string,
    dto: DeletePlatformTenantDto,
    requestId?: string,
  ) {
    const environment = process.env.APP_ENV ?? 'unknown';
    if (environment === 'staging') {
      return this.deleteStagingTenant(admin, tenantCode, dto, requestId);
    }
    const safeRequestId = requestId && /^[A-Za-z0-9_-]{1,128}$/.test(requestId)
      ? requestId
      : undefined;
    let targetTenantId: string | undefined;
    try {
      const target = await this.findTenantIdentity(tenantCode);
      targetTenantId = target.id;
      const result = await this.prisma.$transaction(async (tx) => {
        const identity = await tx.$queryRaw<{
          password_hash: string;
        }[]>(Prisma.sql`
          SELECT a.password_hash
          FROM platform_sessions s
          JOIN platform_admins a ON a.id = s.platform_admin_id
          WHERE s.id = ${admin.session_id}::uuid
            AND s.platform_admin_id = ${admin.platform_admin_id}::uuid
            AND s.revoked_at IS NULL
            AND s.expires_at > (clock_timestamp() AT TIME ZONE 'UTC')
            AND s.identity_version_snapshot = ${admin.identity_version}
            AND a.identity_version = ${admin.identity_version}
            AND a.status = 'active'
          FOR UPDATE OF s, a
        `);
        if (!identity[0]) {
          throw new ForbiddenException({
            code: 'PLATFORM_DELETE_SESSION_INVALID',
            message: '平台会话已失效',
          });
        }
        if (!(await this.passwordMatches(identity[0].password_hash, dto.password))) {
          throw new ForbiddenException({
            code: 'PLATFORM_DELETE_PASSWORD_INVALID',
            message: '管理员密码错误',
          });
        }
        if (environment !== 'production') {
          throw new ServiceUnavailableException({
            code: 'PLATFORM_TENANT_DELETE_ENV_UNAVAILABLE',
            message: '当前环境尚未开放租户删除',
          });
        }
        const locked = await tx.$queryRaw<{
          id: string;
          status: string;
          deleted_at: Date | null;
          purge_after: Date | null;
        }[]>(Prisma.sql`
          SELECT id, status, deleted_at, purge_after
          FROM tenants WHERE id = ${target.id}::uuid FOR UPDATE
        `);
        const tenant = locked[0];
        if (!tenant) throw this.notFound();
        if (tenant.status === 'pending_delete') {
          return { deletedAt: tenant.deleted_at!, purgeAfter: tenant.purge_after!, replayed: true };
        }
        if (tenant.status === 'purged') throw this.deletionConflict();
        const subscription = await tx.subscription.findUnique({
          where: { tenantId: target.id },
        });
        if (!subscription) throw this.notFound();
        if (subscription.status === 'active') {
          throw new ConflictException({
            code: 'PLATFORM_TENANT_ACTIVE_SUBSCRIPTION',
            message: '订阅处于 active 状态的租户不能删除',
          });
        }
        const updated = await tx.$queryRaw<{
          deleted_at: Date;
          purge_after: Date;
        }[]>(Prisma.sql`
          WITH stamp AS (
            SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC') AS value
          )
          UPDATE tenants AS t
          SET status = 'pending_delete',
              deleted_at = stamp.value,
              purge_after = stamp.value + INTERVAL '1 year',
              deleted_from_status = ${tenant.status},
              deleted_from_subscription_status = ${subscription.status},
              updated_at = stamp.value,
              platform_version = platform_version + 1
          FROM stamp WHERE t.id = ${target.id}::uuid
          RETURNING t.deleted_at, t.purge_after
        `);
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { status: 'suspended', version: { increment: 1 } },
        });
        return { deletedAt: updated[0].deleted_at, purgeAfter: updated[0].purge_after, replayed: false };
      });
      await this.audit.record({
        platformAdminId: admin.platform_admin_id,
        targetTenantId,
        requestId: safeRequestId,
        action: 'platform.tenant.delete',
        resourceType: 'tenant',
        resourceId: targetTenantId,
        result: 'success',
        metadata: { environment, reason: result.replayed ? 'ALREADY_PENDING' : 'DELETE_STARTED' },
      });
      return {
        tenant_code: target.tenantCode,
        status: 'pending_delete',
        deleted_at: result.deletedAt.toISOString(),
        purge_after: result.purgeAfter.toISOString(),
        idempotency_replayed: result.replayed,
      };
    } catch (error) {
      const cause = error instanceof HttpException
        ? (error.getResponse() as { code?: string }).code ?? 'REQUEST_REJECTED'
        : 'TRANSACTION_FAILED';
      await this.audit.record({
        platformAdminId: admin.platform_admin_id,
        targetTenantId,
        requestId: safeRequestId,
        action: 'platform.tenant.delete',
        resourceType: 'tenant',
        resourceId: targetTenantId ?? 'unknown',
        result: 'failure',
        metadata: { environment, reason: cause },
      });
      throw error;
    }
  }

  private async deleteStagingTenant(
    admin: AuthenticatedPlatformAdmin,
    tenantCode: string,
    dto: DeletePlatformTenantDto,
    requestId?: string,
  ) {
    const code = tenantCode.trim().toUpperCase();
    const codeHash = this.sha256(code);
    const safeRequestId = requestId && /^[A-Za-z0-9_-]{1,128}$/.test(requestId)
      ? requestId : undefined;
    let targetTenantId: string | undefined;
    try {
      const phase = await this.prisma.$transaction(async (tx) => {
        const identity = await tx.$queryRaw<Array<{ password_hash: string }>>(Prisma.sql`
          SELECT a.password_hash FROM platform_sessions s
          JOIN platform_admins a ON a.id = s.platform_admin_id
          WHERE s.id = ${admin.session_id}::uuid
            AND s.platform_admin_id = ${admin.platform_admin_id}::uuid
            AND s.revoked_at IS NULL
            AND s.expires_at > (clock_timestamp() AT TIME ZONE 'UTC')
            AND s.identity_version_snapshot = ${admin.identity_version}
            AND a.identity_version = ${admin.identity_version}
            AND a.status = 'active'
          FOR UPDATE OF s, a
        `);
        if (!identity[0]) throw new ForbiddenException({
          code: 'PLATFORM_DELETE_SESSION_INVALID', message: '平台会话已失效',
        });
        if (!(await this.passwordMatches(identity[0].password_hash, dto.password))) {
          throw new ForbiddenException({
            code: 'PLATFORM_DELETE_PASSWORD_INVALID', message: '管理员密码错误',
          });
        }
        if (process.env.APP_ENV !== 'staging' || process.env.STAGING_TENANT_DELETE_ENABLED !== 'true') {
          throw new ServiceUnavailableException({
            code: 'PLATFORM_TENANT_DELETE_ENV_UNAVAILABLE', message: '当前环境尚未开放租户删除',
          });
        }
        const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>(Prisma.sql`
          SELECT id, status FROM tenants WHERE tenant_code = ${code} FOR UPDATE
        `);
        if (!locked[0]) {
          const prior = await tx.$queryRaw<Array<{ resource_id: string }>>(Prisma.sql`
            SELECT resource_id FROM platform_audit_logs
            WHERE action = 'platform.tenant.staging_deleted'
              AND metadata_json->>'tenant_code_hash' = ${codeHash}
            ORDER BY created_at DESC LIMIT 1
          `);
          if (!prior[0]) throw this.notFound();
          return { tenantId: prior[0].resource_id, replayed: true };
        }
        const tenant = locked[0];
        if (tenant.status === 'staging_deleting') return { tenantId: tenant.id, replayed: false };
        if (tenant.status === 'pending_delete' || tenant.status === 'purged') throw this.deletionConflict();
        const subscription = await tx.subscription.findUnique({ where: { tenantId: tenant.id } });
        if (!subscription) throw this.notFound();
        if (subscription.status === 'active') throw new ConflictException({
          code: 'PLATFORM_TENANT_ACTIVE_SUBSCRIPTION',
          message: '订阅处于 active 状态的租户不能删除',
        });
        await tx.tenant.update({ where: { id: tenant.id }, data: {
          status: 'staging_deleting', platformVersion: { increment: 1 },
        } });
        await tx.subscription.update({ where: { id: subscription.id }, data: {
          status: 'suspended', version: { increment: 1 },
        } });
        await tx.platformAuditLog.create({ data: {
          platformAdminId: admin.platform_admin_id, targetTenantId: tenant.id,
          requestId: safeRequestId, action: 'platform.tenant.staging_delete_started',
          resourceType: 'tenant', resourceId: tenant.id, result: 'success',
          metadataJson: { environment: 'staging', reason: 'CLEANUP_PENDING' },
        } });
        return { tenantId: tenant.id, replayed: false };
      });
      targetTenantId = phase.tenantId;
      let replayed = phase.replayed;
      if (!phase.replayed) {
        replayed = !(await this.purgeStagingTenant(phase.tenantId, admin.platform_admin_id, codeHash, safeRequestId));
      }
      return { tenant_code: code, status: 'deleted', deleted_at: null, purge_after: null,
        idempotency_replayed: replayed };
    } catch (error) {
      const cause = error instanceof HttpException
        ? (error.getResponse() as { code?: string }).code ?? 'REQUEST_REJECTED'
        : 'TRANSACTION_FAILED';
      await this.audit.record({
        platformAdminId: admin.platform_admin_id, targetTenantId,
        requestId: safeRequestId, action: 'platform.tenant.staging_delete',
        resourceType: 'tenant', resourceId: targetTenantId ?? 'unknown', result: 'failure',
        metadata: { environment: 'staging', reason: cause },
      });
      throw error;
    }
  }

  private async purgeStagingTenant(
    tenantId: string, platformAdminId: string, codeHash: string, requestId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (process.env.APP_ENV !== 'staging' || process.env.STAGING_TENANT_DELETE_ENABLED !== 'true') {
        throw new Error('STAGING_PURGE_WRONG_ENVIRONMENT');
      }
      const locked = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
        SELECT status FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE
      `);
      if (!locked[0]) {
        const prior = await tx.platformAuditLog.findFirst({
          where: { action: 'platform.tenant.staging_deleted', resourceId: tenantId,
            metadataJson: { path: ['tenant_code_hash'], equals: codeHash } },
          select: { id: true },
        });
        if (!prior) throw new Error('STAGING_PURGE_RESULT_MISSING');
        return false;
      }
      if (locked[0].status !== 'staging_deleting') throw new Error('STAGING_PURGE_INVALID_STATE');

      const counts = {
        scan_idempotencies: (await tx.scanRequestIdempotency.deleteMany({ where: { tenantId } })).count,
        attempts: (await tx.mailDeliveryAttempt.deleteMany({ where: { tenantId } })).count,
        mail_jobs: (await tx.mailJob.deleteMany({ where: { tenantId } })).count,
        scan_events: (await tx.scanEvent.deleteMany({ where: { tenantId } })).count,
        audit_logs: (await tx.auditLog.deleteMany({ where: { tenantId } })).count,
        sessions: (await tx.session.deleteMany({ where: { tenantId } })).count,
        assignments: (await tx.operatorLocationAssignment.deleteMany({ where: { tenantId } })).count,
        legacy_identifiers: (await tx.locationLegacyIdentifier.deleteMany({ where: { tenantId } })).count,
        people: (await tx.personMapping.deleteMany({ where: { tenantId } })).count,
        locations: (await tx.location.deleteMany({ where: { tenantId } })).count,
        devices: (await tx.device.deleteMany({ where: { tenantId } })).count,
        users: (await tx.user.deleteMany({ where: { tenantId } })).count,
        subscriptions: (await tx.subscription.deleteMany({ where: { tenantId } })).count,
        platform_idempotencies: (await tx.platformTenantIdempotency.deleteMany({ where: { tenantId } })).count,
        platform_audit_logs: (await tx.platformAuditLog.deleteMany({ where: { targetTenantId: tenantId } })).count,
      };
      const deleted = await tx.tenant.deleteMany({ where: { id: tenantId, status: 'staging_deleting' } });
      if (deleted.count !== 1 || counts.subscriptions !== 1) throw new Error('STAGING_PURGE_COUNT_MISMATCH');
      await tx.platformAuditLog.create({ data: {
        platformAdminId, requestId, action: 'platform.tenant.staging_deleted',
        resourceType: 'tenant', resourceId: tenantId, result: 'success',
        metadataJson: { environment: 'staging', reason: 'DELETED', tenant_code_hash: codeHash, counts },
      } });
      return true;
    }, { timeout: 120_000 });
  }

  async restoreTenant(
    admin: AuthenticatedPlatformAdmin,
    tenantCode: string,
    requestId?: string,
  ) {
    const environment = process.env.APP_ENV ?? 'unknown';
    const safeRequestId = requestId && /^[A-Za-z0-9_-]{1,128}$/.test(requestId)
      ? requestId
      : undefined;
    let targetTenantId: string | undefined;
    try {
      const target = await this.findTenantIdentity(tenantCode);
      targetTenantId = target.id;
      const restored = await this.prisma.$transaction(async (tx) => {
        const identity = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT s.id
          FROM platform_sessions s
          JOIN platform_admins a ON a.id = s.platform_admin_id
          WHERE s.id = ${admin.session_id}::uuid
            AND s.platform_admin_id = ${admin.platform_admin_id}::uuid
            AND s.revoked_at IS NULL
            AND s.expires_at > (clock_timestamp() AT TIME ZONE 'UTC')
            AND s.identity_version_snapshot = ${admin.identity_version}
            AND a.identity_version = ${admin.identity_version}
            AND a.status = 'active'
          FOR UPDATE OF s, a
        `);
        if (!identity[0]) {
          throw new ForbiddenException({
            code: 'PLATFORM_RESTORE_SESSION_INVALID',
            message: '平台会话已失效',
          });
        }
        if (environment !== 'production') {
          throw new ServiceUnavailableException({
            code: 'PLATFORM_TENANT_RESTORE_ENV_UNAVAILABLE',
            message: '当前环境不支持租户恢复',
          });
        }
        const locked = await tx.$queryRaw<{
          status: string;
          deleted_from_status: string | null;
          deleted_from_subscription_status: string | null;
        }[]>(Prisma.sql`
          SELECT status, deleted_from_status, deleted_from_subscription_status
          FROM tenants WHERE id = ${target.id}::uuid FOR UPDATE
        `);
        const tenant = locked[0];
        if (!tenant) throw this.notFound();
        if (tenant.status !== 'pending_delete') {
          throw new ConflictException({
            code: 'PLATFORM_TENANT_NOT_PENDING_DELETE',
            message: '租户不处于可恢复的删除状态',
          });
        }
        if (
          !tenant.deleted_from_status ||
          !tenant.deleted_from_subscription_status ||
          ['pending_delete', 'purged'].includes(tenant.deleted_from_status)
        ) {
          throw new ConflictException({
            code: 'PLATFORM_TENANT_RESTORE_STATE_INVALID',
            message: '删除前状态记录无效，不能恢复',
          });
        }
        const updated = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          UPDATE tenants
          SET status = deleted_from_status,
              deleted_at = NULL,
              purge_after = NULL,
              deleted_from_status = NULL,
              deleted_from_subscription_status = NULL,
              updated_at = clock_timestamp() AT TIME ZONE 'UTC',
              platform_version = platform_version + 1
          WHERE id = ${target.id}::uuid
            AND status = 'pending_delete'
            AND purge_after > (clock_timestamp() AT TIME ZONE 'UTC')
          RETURNING id
        `);
        if (updated.length !== 1) {
          throw new ConflictException({
            code: 'PLATFORM_TENANT_RESTORE_EXPIRED',
            message: '租户恢复期限已过',
          });
        }
        const subscription = await tx.subscription.updateMany({
          where: { tenantId: target.id, status: 'suspended' },
          data: {
            status: tenant.deleted_from_subscription_status,
            version: { increment: 1 },
          },
        });
        if (subscription.count !== 1) {
          throw new ConflictException({
            code: 'PLATFORM_TENANT_RESTORE_STATE_INVALID',
            message: '订阅状态不一致，不能恢复',
          });
        }
        const result = await tx.tenant.findUnique({
          where: { id: target.id },
          select: this.tenantSelect(),
        });
        if (!result) throw this.notFound();
        return this.presentTenant(result);
      });
      await this.audit.record({
        platformAdminId: admin.platform_admin_id,
        targetTenantId,
        requestId: safeRequestId,
        action: 'platform.tenant.restore',
        resourceType: 'tenant',
        resourceId: targetTenantId,
        result: 'success',
        metadata: { environment, reason: 'RESTORED' },
      });
      return restored;
    } catch (error) {
      const cause = error instanceof HttpException
        ? (error.getResponse() as { code?: string }).code ?? 'REQUEST_REJECTED'
        : 'TRANSACTION_FAILED';
      await this.audit.record({
        platformAdminId: admin.platform_admin_id,
        targetTenantId,
        requestId: safeRequestId,
        action: 'platform.tenant.restore',
        resourceType: 'tenant',
        resourceId: targetTenantId ?? 'unknown',
        result: 'failure',
        metadata: { environment, reason: cause },
      });
      throw error;
    }
  }

  private async passwordMatches(hash: string, password: string) {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  private deletionConflict() {
    return new ConflictException({
      code: 'PLATFORM_TENANT_PENDING_DELETE',
      message: '租户处于删除流程，不能通过普通订阅变更恢复',
    });
  }

  async updateLocationLimit(
    admin: AuthenticatedPlatformAdmin,
    tenantCode: string,
    dto: UpdateLocationLimitDto,
    requestId?: string,
  ) {
    const tenant = await this.findTenantIdentity(tenantCode);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${tenant.id}, 0))`,
      );
      const [current, usage] = await Promise.all([
        tx.tenant.findUnique({
          where: { id: tenant.id },
          select: { locationLimit: true, platformVersion: true },
        }),
        tx.location.count({
          where: { tenantId: tenant.id, status: { not: 'purged' } },
        }),
      ]);
      if (!current) throw this.notFound();
      if (current.platformVersion !== dto.version) {
        throw this.versionConflict();
      }
      if (dto.location_limit < usage) {
        throw new ConflictException({
          code: 'LOCATION_LIMIT_BELOW_CURRENT_USAGE',
          message: 'location_limit 不能低于当前计数',
        });
      }
      const result = await tx.tenant.updateMany({
        where: { id: tenant.id, platformVersion: dto.version },
        data: {
          locationLimit: dto.location_limit,
          platformVersion: { increment: 1 },
        },
      });
      if (result.count !== 1) throw this.versionConflict();
      return {
        oldLimit: current.locationLimit,
        newVersion: current.platformVersion + 1,
      };
    });
    await this.audit.record({
      platformAdminId: admin.platform_admin_id,
      targetTenantId: tenant.id,
      requestId,
      action: 'platform.location_limit.update',
      resourceType: 'tenant',
      resourceId: tenant.id,
      result: 'success',
      metadata: {
        old_limit: updated.oldLimit,
        new_limit: dto.location_limit,
        new_version: updated.newVersion,
      },
    });
    return this.getTenant(tenant.tenantCode);
  }

  private tenantSelect() {
    return {
      id: true,
      tenantCode: true,
      name: true,
      status: true,
      deletedAt: true,
      purgeAfter: true,
      locationLimit: true,
      platformVersion: true,
      createdAt: true,
      subscription: {
        select: {
          plan: true,
          status: true,
          startAt: true,
          endAt: true,
          version: true,
        },
      },
      users: {
        where: { role: 'tenant_manager' },
        orderBy: { createdAt: 'asc' as const },
        take: 1,
        select: { email: true, status: true },
      },
      _count: {
        select: {
          locations: { where: { status: { not: 'purged' } } },
        },
      },
      platformAuditLogs: {
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: { id: true, createdAt: true, result: true },
      },
    } satisfies Prisma.TenantSelect;
  }

  private presentTenant(
    tenant: Prisma.TenantGetPayload<{
      select: ReturnType<PlatformTenantsService['tenantSelect']>;
    }>,
  ) {
    const manager = tenant.users[0];
    return {
      tenant_code: tenant.tenantCode,
      name: tenant.name,
      status: tenant.status,
      deleted_at: tenant.deletedAt?.toISOString() ?? null,
      purge_after: tenant.purgeAfter?.toISOString() ?? null,
      created_at: tenant.createdAt.toISOString(),
      platform_version: tenant.platformVersion,
      location_limit: tenant.locationLimit,
      location_count: tenant._count.locations,
      subscription: tenant.subscription
        ? {
            plan: tenant.subscription.plan,
            status: tenant.subscription.status,
            start_at: tenant.subscription.startAt.toISOString(),
            end_at: tenant.subscription.endAt.toISOString(),
            version: tenant.subscription.version,
          }
        : null,
      manager: manager
        ? {
            email_masked: this.maskEmail(manager.email),
            status: manager.status,
          }
        : null,
      recent_platform_operation: tenant.platformAuditLogs[0]
        ? {
            audit_id: tenant.platformAuditLogs[0].id,
            created_at: tenant.platformAuditLogs[0].createdAt.toISOString(),
            result: tenant.platformAuditLogs[0].result,
          }
        : null,
    };
  }

  private async findTenantIdentity(tenantCode: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { tenantCode: tenantCode.trim().toUpperCase() },
      select: { id: true, tenantCode: true },
    });
    if (!tenant) throw this.notFound();
    return tenant;
  }

  private maskEmail(email: string | null) {
    if (!email) return null;
    const [local = '', domain = ''] = email.split('@');
    return local.length <= 1
      ? `*@${domain}`
      : `${local[0]}***${local.at(-1)}@${domain}`;
  }

  private deriveTemporaryPassword(
    secret: string,
    keyHash: string,
    fingerprint: string,
  ) {
    const value = createHmac('sha256', secret)
      .update(`${keyHash}:${fingerprint}`)
      .digest('base64url');
    return `A1a!${value.slice(0, 24)}`;
  }

  private provisioningSecret() {
    const secret = process.env.PLATFORM_PROVISIONING_SECRET;
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException({
        code: 'PLATFORM_PROVISIONING_NOT_CONFIGURED',
        message: '平台租户开通尚未配置',
      });
    }
    return secret;
  }

  private sha256(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private isTenantCodeConflict(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      String(error.meta?.target ?? '').includes('tenant_code')
    );
  }

  private notFound() {
    return new NotFoundException({
      code: 'PLATFORM_TENANT_NOT_FOUND',
      message: 'tenant 不存在',
    });
  }

  private versionConflict() {
    return new ConflictException({
      code: 'PLATFORM_VERSION_CONFLICT',
      message: '数据已被其他操作更新，请刷新后重试',
    });
  }
}
