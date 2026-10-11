import { OciMailRateLimiter } from '../src/mail-jobs/oci-mail-rate-limiter';

describe('OCI global application pacing', () => {
  const now = new Date('2026-09-29T00:00:00.000Z');
  const tenantId = 'tenant-1';
  const jobId = 'job-1';
  const attemptId = 'attempt-1';
  const rfcMessageId = '<attempt-1@mail.example.com>';

  function setup(latest: Date | null, recentCount = latest ? 1 : 0, oldest = latest) {
    const prisma = {
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ dbNow: now, latest, recentCount, oldest }]),
      mailJob: { update: jest.fn().mockResolvedValue(undefined) },
      mailDeliveryAttempt: { update: jest.fn().mockResolvedValue(undefined) },
    };
    Object.assign(prisma, {
      $transaction: jest.fn((callback: (tx: typeof prisma) => unknown) => callback(prisma)),
    });
    return { prisma, limiter: new OciMailRateLimiter(prisma as never) };
  }

  it('reserves before provider invocation when the global 50 ms spacing is clear', async () => {
    const { prisma, limiter } = setup(new Date(now.getTime() - 50));

    await expect(limiter.reserve(tenantId, jobId, attemptId, rfcMessageId))
      .resolves.toEqual({ admitted: true });

    expect(prisma.$queryRawUnsafe).toHaveBeenNthCalledWith(1,
      'SELECT pg_advisory_xact_lock($1::bigint)', 19019139);
    expect(prisma.mailDeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: attemptId, tenantId },
      data: { status: 'invoked', providerInvokedAt: now, rfcMessageId },
    });
    expect(prisma.mailJob.update).not.toHaveBeenCalled();
  });

  it('defers a simultaneous cross-tenant attempt without consuming a retry or invoking provider', async () => {
    const { prisma, limiter } = setup(new Date(now.getTime() - 10));

    await expect(limiter.reserve(tenantId, jobId, attemptId, rfcMessageId))
      .resolves.toEqual({ admitted: false, scheduledAt: new Date(now.getTime() + 40) });

    expect(prisma.mailJob.update).toHaveBeenCalledWith({
      where: { id: jobId, tenantId },
      data: {
        status: 'queued', scheduledAt: new Date(now.getTime() + 40),
        claimedAt: null, claimAttemptId: null, errorMessage: 'PROVIDER_RATE_LIMITED',
      },
    });
    expect(prisma.mailDeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: attemptId, tenantId },
      data: { status: 'deferred', completedAt: now, errorCode: 'PROVIDER_RATE_LIMITED' },
    });
  });

  it('enforces no more than 20 reservations in a rolling second', async () => {
    const { limiter } = setup(new Date(now.getTime() - 50), 20, new Date(now.getTime() - 950));

    await expect(limiter.reserve(tenantId, jobId, attemptId, rfcMessageId))
      .resolves.toEqual({ admitted: false, scheduledAt: new Date(now.getTime() + 51) });
  });

  it('fails closed when the shared database window cannot be read', async () => {
    const { prisma, limiter } = setup(null);
    prisma.$queryRawUnsafe.mockReset()
      .mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(limiter.reserve(tenantId, jobId, attemptId, rfcMessageId))
      .rejects.toThrow('OCI_EMAIL_RATE_WINDOW_UNAVAILABLE');
    expect(prisma.mailDeliveryAttempt.update).not.toHaveBeenCalled();
  });
});
