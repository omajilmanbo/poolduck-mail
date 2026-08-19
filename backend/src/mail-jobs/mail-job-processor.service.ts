import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MailJobsService } from './mail-jobs.service';

const POLL_INTERVAL_MS = 1_000;
const STALE_CLAIM_MS = 60_000;
const CLAIM_ALERT_THRESHOLD_MS = 5_000;

export type ClaimLatencySummary = {
  count: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  overAlertThreshold: number;
};

export function summarizeClaimLatencies(latenciesMs: number[]): ClaimLatencySummary {
  const sorted = latenciesMs
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, value))
    .sort((left, right) => left - right);
  const percentile = (value: number) =>
    sorted.length === 0
      ? 0
      : sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)];
  return {
    count: sorted.length,
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? 0,
    overAlertThreshold: sorted.filter((value) => value > CLAIM_ALERT_THRESHOLD_MS).length,
  };
}

@Injectable()
export class MailJobProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailJobProcessorService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailJobs: MailJobsService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.MAIL_JOB_PROCESSOR_ENABLED === 'false') return;
    this.timer = setInterval(
      () =>
        void this.processDueJobs().catch((error: unknown) => {
          this.logger.error('Automatic mail-job processing failed', error);
        }),
      POLL_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async processDueJobs() {
    if (this.running) return 0;
    this.running = true;
    try {
      await this.mailJobs.recoverStaleProcessingJobs(
        new Date(Date.now() - STALE_CLAIM_MS),
      );
      const due = await this.prisma.$queryRawUnsafe<
        Array<{ id: string; tenantId: string; overdueMs: number | string }>
      >(
        `SELECT "id", "tenant_id" AS "tenantId",
                GREATEST(
                  0,
                  EXTRACT(EPOCH FROM (
                    CURRENT_TIMESTAMP - COALESCE("send_not_before", "scheduled_at", "created_at")
                  )) * 1000
                )::double precision AS "overdueMs"
         FROM "mail_jobs"
         WHERE ("status" = 'waiting' AND "send_not_before" <= CURRENT_TIMESTAMP)
            OR ("status" = 'queued' AND "scheduled_at" <= CURRENT_TIMESTAMP)
            OR ("status" = 'queued' AND "scheduled_at" IS NULL AND "send_not_before" IS NULL)
         ORDER BY COALESCE("send_not_before", "scheduled_at", "created_at") ASC, "id" ASC
         LIMIT 20`,
      );
      const pollStartedAt = Date.now();
      const observedLatencies: number[] = [];
      for (const job of due) {
        const observedLatency = Number(job.overdueMs) + (Date.now() - pollStartedAt);
        try {
          await this.mailJobs.processQueuedMailJob(job.tenantId, job.id, null);
          observedLatencies.push(observedLatency);
        } catch (error) {
          // Another process may have claimed the row after this due-job snapshot.
          // Continue so one contested row cannot block unrelated tenant jobs.
          if (!(error instanceof ConflictException)) throw error;
        }
      }
      if (observedLatencies.length > 0) {
        const summary = summarizeClaimLatencies(observedLatencies);
        const payload = JSON.stringify({
          event: summary.overAlertThreshold > 0
            ? 'mail_job.claim_latency_slo_breach'
            : 'mail_job.claim_latency_batch',
          ...summary,
        });
        if (summary.overAlertThreshold > 0) {
          this.logger.warn(payload);
        } else {
          this.logger.debug(payload);
        }
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }
}
