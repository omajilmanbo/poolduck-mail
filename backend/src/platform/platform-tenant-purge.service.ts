import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PlatformAuditService } from './platform-audit.service';

export type TenantPurgeResult = {
  outcome: 'purged' | 'not_due' | 'already_purged';
  tenantId: string;
  counts?: Record<string, number>;
};

/** Trusted internal entry point for the Production scheduler (#163). No tenant API exposes it. */
@Injectable()
export class PlatformTenantPurgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
  ) {}

  async purgeDueTenant(tenantId: string): Promise<TenantPurgeResult> {
    if (process.env.APP_ENV !== 'production') {
      throw new Error('TENANT_PURGE_PRODUCTION_ONLY');
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new Error('TENANT_PURGE_INVALID_ID');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        // The same row lock is used by delete and restore. Database time is authoritative.
        const rows = await tx.$queryRaw<Array<{ status: string; due: boolean }>>(Prisma.sql`
          SELECT status, purge_after <= (clock_timestamp() AT TIME ZONE 'UTC') AS due
          FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE
        `);
        const tenant = rows[0];
        if (!tenant || tenant.status !== 'pending_delete' || !tenant.due) {
          return {
            outcome: tenant?.status === 'purged' ? 'already_purged' : 'not_due',
            tenantId,
          };
        }

        // Current-only rows can be removed before their parent tombstones are rewritten.
        const assignments = await tx.operatorLocationAssignment.deleteMany({ where: { tenantId } });
        const legacyIdentifiers = await tx.locationLegacyIdentifier.deleteMany({ where: { tenantId } });
        const sessions = await tx.session.deleteMany({ where: { tenantId } });
        const scanIdempotencies = await tx.scanRequestIdempotency.deleteMany({ where: { tenantId } });
        const platformIdempotencies = await tx.platformTenantIdempotency.deleteMany({ where: { tenantId } });

        // Required manager email / operator username constraints need distinct, non-PII values.
        const users = await tx.$executeRaw(Prisma.sql`
          UPDATE users SET
            username = CASE WHEN role = 'operator' THEN replace(id::text, '-', '') ELSE NULL END,
            email = CASE WHEN role = 'tenant_manager'
              THEN 'purged+' || replace(id::text, '-', '') || '@invalid.local' ELSE NULL END,
            password_hash = '!purged', status = 'purged', must_change_password = false,
            last_login_at = NULL, updated_at = clock_timestamp() AT TIME ZONE 'UTC'
          WHERE tenant_id = ${tenantId}::uuid
        `);
        const devices = await tx.$executeRaw(Prisma.sql`
          UPDATE devices SET device_code = 'purged-' || id::text,
            name = '[deleted device ' || id::text || ']', status = 'purged',
            last_seen_at = NULL, updated_at = clock_timestamp() AT TIME ZONE 'UTC'
          WHERE tenant_id = ${tenantId}::uuid
        `);
        const people = await tx.$executeRaw(Prisma.sql`
          UPDATE person_mappings SET person_name = '[deleted person]',
            email = 'deleted@invalid.local', status = 'purged',
            deleted_from_status = NULL, updated_at = clock_timestamp() AT TIME ZONE 'UTC'
          WHERE tenant_id = ${tenantId}::uuid
        `);
        const locations = await tx.$executeRaw(Prisma.sql`
          UPDATE locations SET name = '[deleted location ' || location_code || ']',
            status = 'purged', deleted_from_status = NULL,
            updated_at = clock_timestamp() AT TIME ZONE 'UTC'
          WHERE tenant_id = ${tenantId}::uuid
        `);
        const subscription = await tx.subscription.updateMany({
          where: { tenantId, status: 'suspended' },
          data: { version: { increment: 1 } },
        });
        if (subscription.count !== 1) throw new Error('TENANT_PURGE_SUBSCRIPTION_INVALID');

        // Keep tenant_code, location_code, person_code and scan_code reserved forever.
        const updated = await tx.$executeRaw(Prisma.sql`
          UPDATE tenants SET name = '[deleted tenant ' || id::text || ']',
            status = 'purged', platform_version = platform_version + 1,
            updated_at = clock_timestamp() AT TIME ZONE 'UTC'
          WHERE id = ${tenantId}::uuid AND status = 'pending_delete'
            AND purge_after <= (clock_timestamp() AT TIME ZONE 'UTC')
        `);
        if (updated !== 1) throw new Error('TENANT_PURGE_STATE_CHANGED');

        const counts = {
          users, devices, people, locations,
          assignments: assignments.count, legacy_identifiers: legacyIdentifiers.count,
          sessions: sessions.count, scan_idempotencies: scanIdempotencies.count,
          platform_idempotencies: platformIdempotencies.count,
        };
        await tx.platformAuditLog.create({
          data: {
            targetTenantId: tenantId, action: 'platform.tenant.purged',
            resourceType: 'tenant', resourceId: tenantId, result: 'success',
            metadataJson: { environment: 'production', reason: 'PURGE_DUE', counts },
          },
        });
        return { outcome: 'purged', tenantId, counts };
      }, { timeout: 120_000 });
    } catch (error) {
      await this.audit.record({
        targetTenantId: tenantId, action: 'platform.tenant.purge',
        resourceType: 'tenant', resourceId: tenantId, result: 'failure',
        metadata: { environment: 'production', reason: 'TRANSACTION_FAILED' },
      });
      throw error;
    }
  }
}
