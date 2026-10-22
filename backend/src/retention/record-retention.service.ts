import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL_MAIL = new Set(['sent', 'failed', 'canceled', 'delivery_unknown']);

export type RetentionOutcome = 'deleted' | 'not_due' | 'blocked';

/** Production-only online record destruction. The scheduler is separately gated. */
@Injectable()
export class RecordRetentionService {
  constructor(private readonly prisma: PrismaService) {}

  async dueScanFamilies(limit = 100): Promise<Array<{ id: string; tenantId: string }>> {
    this.assertProduction();
    const size = this.batchSize(limit);
    const rows = await this.prisma.$queryRaw<Array<{ id: string; tenant_id: string }>>(Prisma.sql`
      SELECT s.id, s.tenant_id FROM scan_events s
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
        AND t.status NOT IN ('pending_delete', 'purged', 'staging_deleting')
        AND NOT EXISTS (
          SELECT 1 FROM mail_jobs j WHERE j.scan_event_id = s.id
            AND (j.tenant_id <> s.tenant_id
              OR j.status NOT IN ('sent', 'failed', 'canceled', 'delivery_unknown')
              OR (j.status = 'failed' AND j.scheduled_at IS NOT NULL)
              OR (j.status = 'delivery_unknown' AND NOT EXISTS (
                SELECT 1 FROM mail_delivery_attempts closed
                WHERE closed.mail_job_id = j.id AND closed.status = 'delivery_unknown'
                  AND closed.provider_call_closed_at IS NOT NULL))
              OR EXISTS (SELECT 1 FROM mail_delivery_attempts a
                WHERE a.mail_job_id = j.id
                  AND (a.tenant_id <> s.tenant_id OR a.completed_at IS NULL
                    OR (a.status = 'delivery_unknown' AND a.provider_call_closed_at IS NULL))))
        )
        AND NOT EXISTS (SELECT 1 FROM scan_request_idempotency i
          WHERE (i.scan_event_id = s.id OR i.mail_job_id IN
            (SELECT id FROM mail_jobs WHERE scan_event_id = s.id))
            AND i.tenant_id <> s.tenant_id)
      ORDER BY s.created_at + INTERVAL '1 year', s.id LIMIT ${size}
    `);
    return rows.map((row) => ({ id: row.id, tenantId: row.tenant_id }));
  }

  async purgeScanFamily(tenantId: string, scanId: string): Promise<RetentionOutcome> {
    this.assertProduction();
    if (!UUID.test(tenantId) || !UUID.test(scanId)) throw new Error('RETENTION_INVALID_ID');
    return this.prisma.$transaction(async (tx) => {
      // Delete/restore/purge also lock the tenant row. Recheck after acquiring it.
      const tenants = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
        SELECT status FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE
      `);
      if (!tenants[0] || ['pending_delete', 'purged', 'staging_deleting'].includes(tenants[0].status)) {
        return 'blocked';
      }
      const scans = await tx.$queryRaw<Array<{ due: boolean }>>(Prisma.sql`
        SELECT created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC') AS due
        FROM scan_events WHERE id = ${scanId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE
      `);
      if (!scans[0] || !scans[0].due) return 'not_due';
      const jobs = await tx.$queryRaw<Array<{ id: string; tenant_id: string; status: string; scheduled_at: Date | null }>>(Prisma.sql`
        SELECT id, tenant_id, status, scheduled_at FROM mail_jobs
        WHERE scan_event_id = ${scanId}::uuid FOR UPDATE
      `);
      if (jobs.some((job) => job.tenant_id !== tenantId || !TERMINAL_MAIL.has(job.status)
        || (job.status === 'failed' && job.scheduled_at !== null))) return 'blocked';
      const unsafe = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*) AS count FROM mail_jobs j
        WHERE j.scan_event_id = ${scanId}::uuid AND (
          (j.status = 'delivery_unknown' AND NOT EXISTS (
            SELECT 1 FROM mail_delivery_attempts closed
            WHERE closed.mail_job_id = j.id AND closed.status = 'delivery_unknown'
              AND closed.provider_call_closed_at IS NOT NULL))
          OR EXISTS (SELECT 1 FROM mail_delivery_attempts a
            WHERE a.mail_job_id = j.id
              AND (a.tenant_id <> ${tenantId}::uuid OR a.completed_at IS NULL
                OR (a.status = 'delivery_unknown' AND a.provider_call_closed_at IS NULL))))
      `);
      if (unsafe[0].count !== 0n) return 'blocked';
      const foreignIdempotency = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*) AS count FROM scan_request_idempotency i
        WHERE (i.scan_event_id = ${scanId}::uuid
          OR i.mail_job_id IN (SELECT id FROM mail_jobs WHERE scan_event_id = ${scanId}::uuid))
          AND i.tenant_id <> ${tenantId}::uuid
      `);
      if (foreignIdempotency[0].count !== 0n) return 'blocked';
      await tx.scanRequestIdempotency.deleteMany({ where: {
        tenantId, OR: [{ scanEventId: scanId }, { mailJob: { scanEventId: scanId } }],
      } });
      await tx.mailDeliveryAttempt.deleteMany({ where: { tenantId, mailJob: { scanEventId: scanId } } });
      const removedJobs = await tx.mailJob.deleteMany({ where: { tenantId, scanEventId: scanId } });
      if (removedJobs.count !== jobs.length) throw new Error('RETENTION_MAIL_COUNT_MISMATCH');
      const removedScan = await tx.scanEvent.deleteMany({ where: { id: scanId, tenantId } });
      if (removedScan.count !== 1) throw new Error('RETENTION_SCAN_COUNT_MISMATCH');
      return 'deleted';
    }, { timeout: 60_000 });
  }

  async dueBusinessAudits(limit = 100): Promise<Array<{ id: string; tenantId: string | null }>> {
    this.assertProduction();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; tenant_id: string | null }>>(Prisma.sql`
      SELECT a.id, a.tenant_id FROM audit_logs a
      LEFT JOIN tenants t ON t.id = a.tenant_id
      WHERE a.created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
        AND (t.id IS NULL OR t.status <> 'pending_delete')
      ORDER BY a.created_at + INTERVAL '1 year', a.id LIMIT ${this.batchSize(limit)}
    `);
    return rows.map((row) => ({ id: row.id, tenantId: row.tenant_id }));
  }

  async purgeBusinessAudit(id: string, tenantId: string | null): Promise<RetentionOutcome> {
    this.assertProduction();
    if (!UUID.test(id) || (tenantId && !UUID.test(tenantId))) throw new Error('RETENTION_INVALID_ID');
    return this.prisma.$transaction(async (tx) => {
      if (tenantId) {
        const tenants = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
          SELECT status FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE
        `);
        if (tenants[0]?.status === 'pending_delete') return 'blocked';
      }
      const deleted = await tx.$executeRaw(Prisma.sql`
        DELETE FROM audit_logs WHERE id = ${id}::uuid
          AND tenant_id IS NOT DISTINCT FROM ${tenantId}::uuid
          AND created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
      `);
      return deleted === 1 ? 'deleted' : 'not_due';
    });
  }

  async duePlatformAudits(limit = 100): Promise<Array<{ id: string; tenantId: string | null }>> {
    this.assertProduction();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; target_tenant_id: string | null }>>(Prisma.sql`
      SELECT a.id, a.target_tenant_id FROM platform_audit_logs a
      LEFT JOIN tenants t ON t.id = a.target_tenant_id
      WHERE a.created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
        AND (t.id IS NULL OR t.status <> 'pending_delete')
      ORDER BY a.created_at + INTERVAL '1 year', a.id LIMIT ${this.batchSize(limit)}
    `);
    return rows.map((row) => ({ id: row.id, tenantId: row.target_tenant_id }));
  }

  async purgePlatformAudit(id: string, tenantId: string | null): Promise<RetentionOutcome> {
    this.assertProduction();
    if (!UUID.test(id) || (tenantId && !UUID.test(tenantId))) throw new Error('RETENTION_INVALID_ID');
    return this.prisma.$transaction(async (tx) => {
      if (tenantId) {
        const tenants = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
          SELECT status FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE
        `);
        if (tenants[0]?.status === 'pending_delete') return 'blocked';
      }
      const deleted = await tx.$executeRaw(Prisma.sql`
        DELETE FROM platform_audit_logs WHERE id = ${id}::uuid
          AND target_tenant_id IS NOT DISTINCT FROM ${tenantId}::uuid
          AND created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
      `);
      return deleted === 1 ? 'deleted' : 'not_due';
    });
  }

  private assertProduction() {
    if (process.env.APP_ENV !== 'production') throw new Error('RETENTION_PRODUCTION_ONLY');
  }

  private batchSize(value: number): number {
    if (!Number.isInteger(value) || value < 1) throw new Error('RETENTION_INVALID_BATCH_SIZE');
    return Math.min(value, 500);
  }
}
