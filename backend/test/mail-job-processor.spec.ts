import { ConflictException, Logger } from '@nestjs/common';
import {
  MailJobProcessorService,
  summarizeClaimLatencies,
} from '../src/mail-jobs/mail-job-processor.service';

describe('mail job processor observability', () => {
  afterEach(() => jest.restoreAllMocks());

  it('computes nearest-rank p95/p99 without leaking job payloads', () => {
    expect(summarizeClaimLatencies([0, 100, 1_900, 5_001])).toEqual({
      count: 4,
      p95Ms: 5_001,
      p99Ms: 5_001,
      maxMs: 5_001,
      overAlertThreshold: 1,
    });
    expect(summarizeClaimLatencies([])).toEqual({
      count: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      overAlertThreshold: 0,
    });
  });

  it('emits the safe >5s alert path and continues processing the batch', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([
        { id: 'job-1', tenantId: 'tenant-1', overdueMs: 5_001 },
        { id: 'job-2', tenantId: 'tenant-1', overdueMs: 100 },
      ]),
    };
    const mailJobs = {
      recoverStaleProcessingJobs: jest.fn().mockResolvedValue(0),
      processQueuedMailJob: jest.fn().mockResolvedValue({ status: 'sent' }),
    };
    const processor = new MailJobProcessorService(prisma as never, mailJobs as never);

    await expect(processor.processDueJobs()).resolves.toBe(2);

    expect(mailJobs.processQueuedMailJob).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const alert = JSON.parse(String(warn.mock.calls[0][0])) as Record<string, unknown>;
    expect(alert).toMatchObject({
      event: 'mail_job.claim_latency_slo_breach',
      count: 2,
      overAlertThreshold: 1,
    });
    expect(JSON.stringify(alert)).not.toContain('job-1');
    expect(JSON.stringify(alert)).not.toContain('tenant-1');
  });

  it('does not count another worker claim as this worker latency', async () => {
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([
        { id: 'contested', tenantId: 'tenant-1', overdueMs: 1_000 },
        { id: 'won', tenantId: 'tenant-1', overdueMs: 1_100 },
      ]),
    };
    const mailJobs = {
      recoverStaleProcessingJobs: jest.fn().mockResolvedValue(0),
      processQueuedMailJob: jest
        .fn()
        .mockRejectedValueOnce(new ConflictException())
        .mockResolvedValueOnce({ status: 'sent' }),
    };

    await new MailJobProcessorService(
      prisma as never,
      mailJobs as never,
    ).processDueJobs();

    const summary = JSON.parse(String(debug.mock.calls[0][0])) as Record<string, unknown>;
    expect(summary.count).toBe(1);
    expect(Number(summary.p95Ms)).toBeGreaterThanOrEqual(1_100);
    expect(summary.p99Ms).toBe(summary.p95Ms);
  });
});
