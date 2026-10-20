import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { PlatformTenantPurgeService } from './platform-tenant-purge.service';

const INTERVAL_MS = 60_000;
const BATCH_SIZE = 20;
const OVERDUE_ALERT_SECONDS = 900;

export type TenantPurgeRun = {
  pending: number;
  oldestOverdueSeconds: number;
  purged: number;
  failed: number;
  skipped: number;
};

@Injectable()
export class PlatformTenantPurgeSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformTenantPurgeSchedulerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly purge: PlatformTenantPurgeService,
  ) {}

  onModuleInit() {
    if (process.env.TENANT_PURGE_PROCESSOR_ENABLED !== 'true') return;
    if (process.env.APP_ENV !== 'production') {
      this.logger.error(JSON.stringify({ event: 'tenant_purge_alert', reason: 'WRONG_ENVIRONMENT' }));
      return;
    }
    if (process.env.NODE_ENV === 'test') return;
    void this.runOnce().catch(() => this.logAlert('SCAN_FAILED'));
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => this.logAlert('SCAN_FAILED'));
    }, INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<TenantPurgeRun> {
    if (process.env.APP_ENV !== 'production') {
      this.logAlert('WRONG_ENVIRONMENT');
      throw new Error('TENANT_PURGE_PRODUCTION_ONLY');
    }
    if (this.running) return { pending: 0, oldestOverdueSeconds: 0, purged: 0, failed: 0, skipped: 0 };
    this.running = true;
    try {
      const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM tenants
        WHERE status = 'pending_delete'
          AND purge_after <= (clock_timestamp() AT TIME ZONE 'UTC')
        ORDER BY purge_after, id LIMIT ${BATCH_SIZE}
      `);
      let purged = 0;
      let failed = 0;
      let skipped = 0;
      for (const candidate of candidates) {
        try {
          const result = await this.purge.purgeDueTenant(candidate.id);
          if (result.outcome === 'purged') purged += 1;
          else skipped += 1;
        } catch {
          failed += 1;
          this.logAlert('TENANT_TRANSACTION_FAILED', candidate.id);
          break;
        }
      }
      const backlog = await this.prisma.$queryRaw<Array<{ pending: bigint; oldest_seconds: number }>>(Prisma.sql`
        SELECT count(*) AS pending,
          coalesce(extract(epoch FROM (clock_timestamp() AT TIME ZONE 'UTC') - min(purge_after)), 0)::float8 AS oldest_seconds
        FROM tenants WHERE status = 'pending_delete'
          AND purge_after <= (clock_timestamp() AT TIME ZONE 'UTC')
      `);
      const summary: TenantPurgeRun = {
        pending: Number(backlog[0].pending),
        oldestOverdueSeconds: Math.max(0, Math.floor(backlog[0].oldest_seconds)),
        purged, failed, skipped,
      };
      this.logger.log(JSON.stringify({ event: 'tenant_purge_metrics', ...summary }));
      if (summary.oldestOverdueSeconds > OVERDUE_ALERT_SECONDS) {
        this.logAlert('BACKLOG_OVERDUE');
      }
      return summary;
    } finally {
      this.running = false;
    }
  }

  private logAlert(reason: string, tenantId?: string) {
    this.logger.error(JSON.stringify({ event: 'tenant_purge_alert', reason, tenant_id: tenantId ?? null }));
  }
}
