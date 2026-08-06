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
        Array<{ id: string; tenantId: string }>
      >(
        `SELECT "id", "tenant_id" AS "tenantId"
         FROM "mail_jobs"
         WHERE ("status" = 'waiting' AND "send_not_before" <= CURRENT_TIMESTAMP)
            OR ("status" = 'queued' AND "scheduled_at" <= CURRENT_TIMESTAMP)
            OR ("status" = 'queued' AND "scheduled_at" IS NULL AND "send_not_before" IS NULL)
         ORDER BY COALESCE("send_not_before", "scheduled_at", "created_at") ASC, "id" ASC
         LIMIT 20`,
      );
      for (const job of due) {
        try {
          await this.mailJobs.processQueuedMailJob(job.tenantId, job.id, null);
        } catch (error) {
          // Another process may have claimed the row after this due-job snapshot.
          // Continue so one contested row cannot block unrelated tenant jobs.
          if (!(error instanceof ConflictException)) throw error;
        }
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }
}
