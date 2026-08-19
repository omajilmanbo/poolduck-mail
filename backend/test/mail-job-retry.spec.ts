import { ConflictException } from '@nestjs/common';
import { MailJobsService } from '../src/mail-jobs/mail-jobs.service';

describe('mail job retry policy', () => {
  const now = new Date('2026-07-23T00:00:00.000Z');

  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it.each([
    [0, 1, '2026-07-23T00:00:30.000Z', 'queued'],
    [1, 2, '2026-07-23T00:02:00.000Z', 'queued'],
    [2, 3, '2026-07-23T00:10:00.000Z', 'queued'],
    [3, 4, null, 'failed'],
  ])('applies the approved retry boundary from retry_count=%s', async (current, next, scheduled, status) => {
    const { service, prisma, provider } = setup(current, 1);
    const result = await service.processQueuedMailJob('tenant-1', 'job-1', 'user-1');

    expect(result).toMatchObject({
      status,
      retry_count: next,
      scheduled_at: scheduled,
    });
    expect(prisma.mailJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({
        status,
        retryCount: next,
        scheduledAt: scheduled ? new Date(scheduled) : null,
      }),
    });
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Tenant，Officeからのお知らせ：Person　さんは　20260723000000　に退室しました。',
    }));
  });

  it('does not call the provider when another processor owns the atomic claim', async () => {
    const { service, provider } = setup(0, 0, 'processing');
    await expect(service.processQueuedMailJob('tenant-1', 'job-1', null)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('allows only one of two workers to create an attempt and invoke the provider', async () => {
    const { service, prisma, provider } = setup(0, 1);
    prisma.$executeRawUnsafe
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const results = await Promise.allSettled([
      service.processQueuedMailJob('tenant-1', 'job-1', null),
      service.processQueuedMailJob('tenant-1', 'job-1', null),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(prisma.mailDeliveryAttempt.create).toHaveBeenCalledTimes(1);
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('returns a stale pre-provider claim to waiting without invoking the provider', async () => {
    const { service, prisma, provider } = setup(0, 0);
    prisma.mailJob.findMany.mockResolvedValue([
      {
        id: 'job-1',
        tenantId: 'tenant-1',
        claimAttemptId: 'attempt-1',
        retryCount: 0,
        sendNotBefore: now,
      },
    ]);
    prisma.mailDeliveryAttempt.findUnique.mockResolvedValue({
      providerInvokedAt: null,
      completedAt: null,
    });

    await expect(service.recoverStaleProcessingJobs(now)).resolves.toBe(1);

    expect(prisma.mailJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'job-1',
        tenantId: 'tenant-1',
        status: 'processing',
        claimAttemptId: 'attempt-1',
      },
      data: {
        status: 'waiting',
        claimedAt: null,
        claimAttemptId: null,
        errorMessage: null,
      },
    });
    expect(prisma.mailDeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: {
        status: 'abandoned',
        completedAt: now,
        errorCode: 'STALE_BEFORE_PROVIDER',
      },
    });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('moves a stale invoked claim to delivery_unknown and never auto-retries it', async () => {
    const { service, prisma, provider } = setup(0, 0);
    prisma.mailJob.findMany.mockResolvedValue([
      {
        id: 'job-1',
        tenantId: 'tenant-1',
        claimAttemptId: 'attempt-1',
        retryCount: 0,
        sendNotBefore: now,
      },
    ]);
    prisma.mailDeliveryAttempt.findUnique.mockResolvedValue({
      providerInvokedAt: new Date(now.getTime() - 1_000),
      completedAt: null,
    });

    await expect(service.recoverStaleProcessingJobs(now)).resolves.toBe(1);

    expect(prisma.mailJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', tenantId: 'tenant-1', status: 'processing' },
      data: {
        status: 'delivery_unknown',
        errorMessage: 'PROVIDER_OUTCOME_UNKNOWN',
      },
    });
    expect(prisma.mailDeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: {
        status: 'delivery_unknown',
        completedAt: now,
        errorCode: 'PROVIDER_OUTCOME_UNKNOWN',
      },
    });
    expect(provider.send).not.toHaveBeenCalled();
  });

  function setup(retryCount: number, claim: number, currentStatus = 'queued') {
    const prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(claim),
      mailJob: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: claim }),
        findFirst: jest.fn().mockResolvedValue({ id: 'job-1', status: currentStatus, scheduledAt: null, sendNotBefore: null }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'job-1',
          toEmail: 'recipient@example.local',
          subject: 'subject',
          body: 'Tenant，Officeからのお知らせ：Person　さんは　20260723000000　に退室しました。',
          retryCount,
          location: { status: 'active' },
          personMapping: { status: 'active' },
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      mailDeliveryAttempt: {
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
        findUnique: jest.fn(),
      },
    };
    Object.assign(prisma, {
      $transaction: jest.fn(async (input: unknown) =>
        typeof input === 'function'
          ? (input as (tx: typeof prisma) => unknown)(prisma)
          : Promise.all(input as Promise<unknown>[]),
      ),
    });
    const license = {
      checkTenantLicense: jest.fn().mockResolvedValue({ status: 'active' }),
      assertCanSend: jest.fn(),
    };
    const provider = {
      send: jest.fn().mockResolvedValue({
        provider: 'sandbox',
        success: false,
        errorMessage: 'Sandbox provider simulated failure',
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    return {
      prisma,
      provider,
      service: new MailJobsService(
        prisma as never,
        license as never,
        provider as never,
        audit as never,
        {} as never,
      ),
    };
  }
});
