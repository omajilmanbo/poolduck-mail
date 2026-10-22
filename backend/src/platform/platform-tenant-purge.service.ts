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
        await tx.$queryRaw(Prisma.sql`SELECT set_config('statement_timeout', '600000', true)`);
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

        // A suspended tenant cannot start another send, but an earlier provider
        // invocation may still be in flight. Leave the entire transaction intact
        // and retry after its attempt reaches a recorded outcome.
        const unsafeMail = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT count(*) AS count FROM mail_jobs j
          WHERE j.tenant_id = ${tenantId}::uuid
            AND (j.status = 'processing' OR EXISTS (
              SELECT 1 FROM mail_delivery_attempts a
              WHERE a.mail_job_id = j.id AND a.completed_at IS NULL))
        `);
        if (unsafeMail[0].count !== 0n) throw new Error('TENANT_PURGE_MAIL_IN_FLIGHT');

        const expected = {
          users: await tx.user.count({ where: { tenantId } }),
          devices: await tx.device.count({ where: { tenantId } }),
          people: await tx.personMapping.count({ where: { tenantId } }),
          locations: await tx.location.count({ where: { tenantId } }),
          assignments: await tx.operatorLocationAssignment.count({ where: { tenantId } }),
          legacy_identifiers: await tx.locationLegacyIdentifier.count({ where: { tenantId } }),
          sessions: await tx.session.count({ where: { tenantId } }),
          scan_idempotencies: await tx.scanRequestIdempotency.count({ where: { tenantId } }),
          attempts: await tx.mailDeliveryAttempt.count({ where: { tenantId } }),
          mail_jobs: await tx.mailJob.count({ where: { tenantId } }),
          scan_events: await tx.scanEvent.count({ where: { tenantId } }),
          audit_logs: await tx.auditLog.count({ where: { tenantId } }),
          platform_idempotencies: await tx.platformTenantIdempotency.count({ where: { tenantId } }),
        };

        // ADR-024: destroy the entire online record graph before current-object
        // tombstones. FK children go first; counts and the status update commit
        // atomically, so failure leaves the tenant pending and recoverable only
        // according to the original deadline.
        const scanIdempotencies = await tx.scanRequestIdempotency.deleteMany({ where: { tenantId } });
        const attempts = await tx.mailDeliveryAttempt.deleteMany({ where: { tenantId } });
        const mailJobs = await tx.mailJob.deleteMany({ where: { tenantId } });
        const scanEvents = await tx.scanEvent.deleteMany({ where: { tenantId } });
        const auditLogs = await tx.auditLog.deleteMany({ where: { tenantId } });

        // Current-only rows can be removed before their parent tombstones are rewritten.
        const assignments = await tx.operatorLocationAssignment.deleteMany({ where: { tenantId } });
        const legacyIdentifiers = await tx.locationLegacyIdentifier.deleteMany({ where: { tenantId } });
        const sessions = await tx.session.deleteMany({ where: { tenantId } });
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
          attempts: attempts.count, mail_jobs: mailJobs.count,
          scan_events: scanEvents.count, audit_logs: auditLogs.count,
          platform_idempotencies: platformIdempotencies.count,
        };
        if (Object.keys(expected).some((key) => counts[key as keyof typeof counts] !== expected[key as keyof typeof expected])) {
          throw new Error('TENANT_PURGE_COUNT_MISMATCH');
        }
        await tx.platformAuditLog.create({
          data: {
            targetTenantId: tenantId, action: 'platform.tenant.purged',
            resourceType: 'tenant', resourceId: tenantId, result: 'success',
            metadataJson: { environment: 'production', reason: 'PURGE_DUE', counts },
          },
        });
        return { outcome: 'purged', tenantId, counts };
      }, { timeout: 660_000 });
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
