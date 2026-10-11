import { ConflictException } from '@nestjs/common';
import { MailJobsService } from '../src/mail-jobs/mail-jobs.service';
import { MailProviderConfig } from '../src/mail-jobs/mail-provider.config';

describe('mail job retry policy', () => {
  const now = new Date('2026-07-23T00:00:00.000Z');
  const ociConfig: MailProviderConfig = {
    kind: 'oci_email_delivery_https', region: 'ap-tokyo-1',
    senderCompartmentId: 'ocid1.compartment.oc1..synthetic',
    fromAddress: 'sender@example.com', messageIdDomain: 'mail.example.com',
  };

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

  it('uses the persisted recipient snapshot for a newly added person address', async () => {
    const { service, provider } = setup(0, 1, 'queued', 'new-person@example.local');

    await service.processQueuedMailJob('tenant-1', 'job-1', null);

    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      toEmail: 'new-person@example.local',
    }));
  });

  it('persists the OCI Message-ID before submission and attaches receipt IDs to the same tenant attempt', async () => {
    const { service, prisma, provider, rateLimiter } = setup(0, 1, 'queued', 'recipient@example.com', ociConfig);
    provider.send.mockImplementation(async ({ attemptId }: { attemptId: string }) => {
      expect(rateLimiter.reserve).toHaveBeenCalledWith(
        'tenant-1', 'job-1', attemptId, `<${attemptId}@mail.example.com>`,
      );
      return {
        provider: 'oci_email_delivery_https', success: true, disposition: 'accepted',
        providerMessageId: 'accepted@mail.example.com',
        envelopeId: 'envelope-synthetic', opcRequestId: 'request-synthetic',
      };
    });

    const result = await service.processQueuedMailJob('tenant-1', 'job-1', null);

    expect(result.status).toBe('sent');
    const attemptId = provider.send.mock.calls[0][0].attemptId;
    expect(provider.send).toHaveBeenCalledWith(expect.objectContaining({
      attemptId, toEmail: 'recipient@example.com',
    }));
    expect(prisma.mailDeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: attemptId, tenantId: 'tenant-1' },
      data: expect.objectContaining({
        status: 'succeeded', providerMessageId: 'accepted@mail.example.com',
        envelopeId: 'envelope-synthetic', opcRequestId: 'request-synthetic',
      }),
    });
  });

  it.each([
    ['transient', 'PROVIDER_TRANSIENT', 'queued', 1, new Date(now.getTime() + 30_000)],
    ['permanent', 'OCI_AUTH_REJECTED', 'failed', 0, null],
    ['suppressed', 'RECIPIENT_SUPPRESSED', 'failed', 0, null],
    ['unknown', 'PROVIDER_OUTCOME_UNKNOWN', 'delivery_unknown', 0, null],
  ] as const)('handles OCI %s without unsafe retries', async (disposition, errorCode, status, retryCount, scheduledAt) => {
    const { service, prisma, provider } = setup(0, 1, 'queued', 'recipient@example.com', ociConfig);
    provider.send.mockResolvedValue({
      provider: 'oci_email_delivery_https', success: false, disposition, errorCode,
      opcRequestId: 'request-synthetic',
    });

    const result = await service.processQueuedMailJob('tenant-1', 'job-1', null);

    expect(result).toMatchObject({ status, retry_count: retryCount,
      scheduled_at: scheduledAt?.toISOString() ?? null,
      provider_result: { provider: 'oci_email_delivery_https', success: false, error_message: errorCode },
    });
    expect(prisma.mailJob.update).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'job-1' }),
      data: expect.objectContaining({ status, errorMessage: errorCode }),
    });
    expect(prisma.mailDeliveryAttempt.update).toHaveBeenCalledWith({
      where: expect.objectContaining({ tenantId: 'tenant-1' }),
      data: expect.objectContaining({ opcRequestId: 'request-synthetic', errorCode }),
    });
    expect(JSON.stringify(prisma.mailJob.update.mock.calls)).not.toContain('recipient@example.com');
  });

  it('marks a thrown OCI provider error unknown without retrying or persisting its raw text', async () => {
    const { service, prisma, provider } = setup(0, 1, 'queued', 'recipient@example.com', ociConfig);
    provider.send.mockRejectedValue(new Error('secret recipient@example.com'));

    const result = await service.processQueuedMailJob('tenant-1', 'job-1', null);

    expect(result.status).toBe('delivery_unknown');
    expect(result.retry_count).toBe(0);
    expect(JSON.stringify(result)).not.toContain('recipient@example.com');
    expect(prisma.mailJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1', tenantId: 'tenant-1' },
      data: expect.objectContaining({ status: 'delivery_unknown', errorMessage: 'PROVIDER_OUTCOME_UNKNOWN' }),
    });
  });

  it('exhausts only explicitly transient OCI rejections after the bounded attempts', async () => {
    const { service, prisma, provider } = setup(3, 1, 'queued', 'recipient@example.com', ociConfig);
    provider.send.mockResolvedValue({
      provider: 'oci_email_delivery_https', success: false,
      disposition: 'transient', errorCode: 'PROVIDER_TRANSIENT',
    });

    const result = await service.processQueuedMailJob('tenant-1', 'job-1', null);

    expect(result).toMatchObject({ status: 'failed', retry_count: 4, scheduled_at: null });
    expect(prisma.mailJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: expect.objectContaining({ status: 'failed', errorMessage: 'PROVIDER_TRANSIENT' }),
    });
  });

  it('does not mark an incomplete OCI accepted result as sent', async () => {
    const { service, provider } = setup(0, 1, 'queued', 'recipient@example.com', ociConfig);
    provider.send.mockResolvedValue({
      provider: 'oci_email_delivery_https', success: true, disposition: 'accepted',
      providerMessageId: 'synthetic-id',
    });

    const result = await service.processQueuedMailJob('tenant-1', 'job-1', null);

    expect(result.status).toBe('delivery_unknown');
    expect(result.retry_count).toBe(0);
  });

  it('does not call OCI or consume retries when the global application pace defers a job', async () => {
    const { service, provider, rateLimiter, prisma } = setup(1, 1, 'queued', 'recipient@example.com', ociConfig);
    const scheduledAt = new Date(now.getTime() + 50);
    rateLimiter.reserve.mockResolvedValue({ admitted: false, scheduledAt });

    const result = await service.processQueuedMailJob('tenant-1', 'job-1', null);

    expect(result).toMatchObject({
      status: 'queued', retry_count: 1, scheduled_at: scheduledAt.toISOString(),
      provider_result: { provider: 'oci_email_delivery_https', success: false, error_message: 'PROVIDER_RATE_LIMITED' },
    });
    expect(provider.send).not.toHaveBeenCalled();
    expect(rateLimiter.reserve).toHaveBeenCalledWith('tenant-1', 'job-1', expect.any(String), expect.any(String));
    expect(prisma.mailDeliveryAttempt.update).not.toHaveBeenCalled();
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

  function setup(retryCount: number, claim: number, currentStatus = 'queued', toEmail = 'recipient@example.local', config: MailProviderConfig = { kind: 'mock' }) {
    const prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(claim),
      mailJob: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: claim }),
        findFirst: jest.fn().mockResolvedValue({ id: 'job-1', status: currentStatus, scheduledAt: null, sendNotBefore: null }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: 'job-1',
          toEmail,
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
    const rateLimiter = { reserve: jest.fn().mockResolvedValue({ admitted: true }) };
    return {
      prisma,
      provider,
      rateLimiter,
      service: new MailJobsService(
        prisma as never,
        license as never,
        provider as never,
        audit as never,
        {} as never,
        config,
        rateLimiter as never,
      ),
    };
  }
});
