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
    const { service, prisma, provider } = setup(current, { count: 1 });
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
    const { service, provider } = setup(0, { count: 0 }, 'processing');
    await expect(service.processQueuedMailJob('tenant-1', 'job-1', null)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.send).not.toHaveBeenCalled();
  });

  function setup(retryCount: number, claim: { count: number }, currentStatus = 'queued') {
    const prisma = {
      mailJob: {
        updateMany: jest.fn().mockResolvedValue(claim),
        findFirst: jest.fn().mockResolvedValue({ id: 'job-1', status: currentStatus, scheduledAt: null }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'job-1',
          toEmail: 'recipient@example.local',
          subject: 'subject',
          body: 'Tenant，Officeからのお知らせ：Person　さんは　20260723000000　に退室しました。',
          retryCount,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
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
