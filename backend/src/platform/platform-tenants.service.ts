import {
  BadRequestException,
  ConflictException,
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
    const current = await this.prisma.subscription.findUnique({
      where: { tenantId: tenant.id },
    });
    if (!current) throw this.notFound();
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
    if (
      dto.status === 'suspended' &&
      (startAt.getTime() !== current.startAt.getTime() ||
        endAt.getTime() !== current.endAt.getTime())
    ) {
      throw new BadRequestException({
        code: 'SUSPENSION_INTERVAL_MUST_BE_PRESERVED',
        message: '暂停时必须保留原订阅时间区间',
      });
    }
    const updated = await this.prisma.subscription.updateMany({
      where: { tenantId: tenant.id, version: dto.version },
      data: {
        status: dto.status,
        startAt,
        endAt,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw this.versionConflict();
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
