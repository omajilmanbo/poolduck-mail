import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PlatformAuditService } from '../platform/platform-audit.service';
import { RecordRetentionService, RetentionOutcome } from './record-retention.service';

const INTERVAL_MS = 60_000;
const BATCH_SIZE = 100;

export type RetentionRun = {
  scanFamilies: number;
  businessAudits: number;
  platformAudits: number;
  blocked: number;
  unsafeDueFamilies: number;
  scanBacklog: number;
  businessAuditBacklog: number;
  platformAuditBacklog: number;
  oldestOverdueSeconds: number;
  failed: number;
};

@Injectable()
export class RecordRetentionSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecordRetentionSchedulerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly retention: RecordRetentionService,
    private readonly audit: PlatformAuditService,
  ) {}

  onModuleInit() {
    if (process.env.RECORD_RETENTION_PROCESSOR_ENABLED !== 'true') return;
    if (process.env.APP_ENV !== 'production') {
      this.alert('WRONG_ENVIRONMENT');
      return;
    }
    if (process.env.NODE_ENV === 'test') return;
    void this.runOnce().catch(() => this.alert('RUN_FAILED'));
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => this.alert('RUN_FAILED'));
    }, INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<RetentionRun> {
    if (process.env.APP_ENV !== 'production') throw new Error('RETENTION_PRODUCTION_ONLY');
    if (this.running) return { scanFamilies: 0, businessAudits: 0, platformAudits: 0,
      blocked: 0, unsafeDueFamilies: 0, scanBacklog: 0, businessAuditBacklog: 0,
      platformAuditBacklog: 0, oldestOverdueSeconds: 0, failed: 0 };
    this.running = true;
    const summary: RetentionRun = { scanFamilies: 0, businessAudits: 0, platformAudits: 0,
      blocked: 0, unsafeDueFamilies: 0, scanBacklog: 0, businessAuditBacklog: 0,
      platformAuditBacklog: 0, oldestOverdueSeconds: 0, failed: 0 };
    try {
      const scans = await this.retention.dueScanFamilies(BATCH_SIZE);
      for (const scan of scans) {
        try { this.count(summary, 'scanFamilies', await this.retention.purgeScanFamily(scan.tenantId, scan.id)); }
        catch { summary.failed += 1; this.alert('SCAN_FAMILY_FAILED'); break; }
      }
      const audits = await this.retention.dueBusinessAudits(BATCH_SIZE);
      for (const row of audits) {
        try { this.count(summary, 'businessAudits', await this.retention.purgeBusinessAudit(row.id, row.tenantId)); }
        catch { summary.failed += 1; this.alert('BUSINESS_AUDIT_FAILED'); break; }
      }
      const platformAudits = await this.retention.duePlatformAudits(BATCH_SIZE);
      for (const row of platformAudits) {
        try { this.count(summary, 'platformAudits', await this.retention.purgePlatformAudit(row.id, row.tenantId)); }
        catch { summary.failed += 1; this.alert('PLATFORM_AUDIT_FAILED'); break; }
      }
      const unsafe = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT count(*) AS count
        FROM scan_events s JOIN tenants t ON t.id = s.tenant_id
        WHERE s.created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
          AND t.status NOT IN ('pending_delete', 'purged', 'staging_deleting')
          AND (EXISTS (SELECT 1 FROM mail_jobs j WHERE j.scan_event_id = s.id
            AND (j.tenant_id <> s.tenant_id
              OR j.status NOT IN ('sent', 'failed', 'canceled', 'delivery_unknown')
              OR (j.status = 'failed' AND j.scheduled_at IS NOT NULL)
              OR EXISTS (SELECT 1 FROM mail_delivery_attempts a
                WHERE a.mail_job_id = j.id
                  AND (a.tenant_id <> s.tenant_id OR a.completed_at IS NULL))))
          OR EXISTS (SELECT 1 FROM scan_request_idempotency i
            WHERE (i.scan_event_id = s.id OR i.mail_job_id IN
              (SELECT id FROM mail_jobs WHERE scan_event_id = s.id))
              AND i.tenant_id <> s.tenant_id))
      `);
      summary.unsafeDueFamilies = Number(unsafe[0].count);
      const backlog = await this.prisma.$queryRaw<Array<{
        scan_count: bigint; business_count: bigint; platform_count: bigint;
        oldest_seconds: number;
      }>>(Prisma.sql`
        SELECT
          (SELECT count(*) FROM scan_events s JOIN tenants t ON t.id = s.tenant_id
            WHERE s.created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
              AND t.status NOT IN ('pending_delete', 'purged', 'staging_deleting')) AS scan_count,
          (SELECT count(*) FROM audit_logs a LEFT JOIN tenants t ON t.id = a.tenant_id
            WHERE a.created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
              AND (t.id IS NULL OR t.status <> 'pending_delete')) AS business_count,
          (SELECT count(*) FROM platform_audit_logs a LEFT JOIN tenants t ON t.id = a.target_tenant_id
            WHERE a.created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
              AND (t.id IS NULL OR t.status <> 'pending_delete')) AS platform_count,
          greatest(
            coalesce((SELECT extract(epoch FROM (clock_timestamp() AT TIME ZONE 'UTC')
              - min(s.created_at + INTERVAL '1 year')) FROM scan_events s
              JOIN tenants t ON t.id = s.tenant_id
              WHERE s.created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
                AND t.status NOT IN ('pending_delete', 'purged', 'staging_deleting')), 0),
            coalesce((SELECT extract(epoch FROM (clock_timestamp() AT TIME ZONE 'UTC')
              - min(a.created_at + INTERVAL '1 year')) FROM audit_logs a
              LEFT JOIN tenants t ON t.id = a.tenant_id
              WHERE a.created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
                AND (t.id IS NULL OR t.status <> 'pending_delete')), 0),
            coalesce((SELECT extract(epoch FROM (clock_timestamp() AT TIME ZONE 'UTC')
              - min(a.created_at + INTERVAL '1 year')) FROM platform_audit_logs a
              LEFT JOIN tenants t ON t.id = a.target_tenant_id
              WHERE a.created_at + INTERVAL '1 year' <= (clock_timestamp() AT TIME ZONE 'UTC')
                AND (t.id IS NULL OR t.status <> 'pending_delete')), 0)
          )::float8 AS oldest_seconds
      `);
      summary.scanBacklog = Number(backlog[0].scan_count);
      summary.businessAuditBacklog = Number(backlog[0].business_count);
      summary.platformAuditBacklog = Number(backlog[0].platform_count);
      summary.oldestOverdueSeconds = Math.max(0, Math.floor(backlog[0].oldest_seconds));
      if (summary.unsafeDueFamilies > 0) this.alert('UNSAFE_MAIL_FAMILY_OVERDUE');
      if (summary.oldestOverdueSeconds > 900) this.alert('BACKLOG_OVERDUE');
      this.logger.log(JSON.stringify({ event: 'record_retention_metrics', ...summary }));
      if (summary.scanFamilies + summary.businessAudits + summary.platformAudits > 0 || summary.failed > 0) {
        const recorded = await this.audit.record({ action: 'platform.record_retention.run', resourceType: 'retention',
          resourceId: 'production', result: summary.failed > 0 ? 'failure' : 'success',
          metadata: { counts: summary },
        });
        if (!recorded) this.alert('AUDIT_WRITE_FAILED');
      }
      return summary;
    } finally {
      this.running = false;
    }
  }

  private count(summary: RetentionRun, key: 'scanFamilies' | 'businessAudits' | 'platformAudits', outcome: RetentionOutcome) {
    if (outcome === 'deleted') summary[key] += 1;
    if (outcome === 'blocked') summary.blocked += 1;
  }

  private alert(reason: string) {
    this.logger.error(JSON.stringify({ event: 'record_retention_alert', reason }));
  }
}
