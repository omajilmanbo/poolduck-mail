import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { MailJobsService } from './mail-jobs.service';

const POLL_INTERVAL_MS = 15_000;

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
      const due = await this.prisma.mailJob.findMany({
        where: { status: 'queued', scheduledAt: { lte: new Date() } },
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        take: 20,
        select: { id: true, tenantId: true },
      });
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
