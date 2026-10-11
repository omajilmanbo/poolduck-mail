import * as common from 'oci-common';
import { AuditService } from '../src/audit/audit.service';
import { LicenseService } from '../src/license/license.service';
import { MailJobsService } from '../src/mail-jobs/mail-jobs.service';
import { OciEmailDeliveryProvider, OciMailConfig, OciSubmitClient } from '../src/mail-jobs/oci-email-delivery.provider';
import { PrismaService } from '../src/prisma.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const recipient = 'snapshot@synthetic.invalid';
const body = 'synthetic-body-canary';
const config: OciMailConfig = {
  kind: 'oci_email_delivery_https',
  region: 'ap-tokyo-1',
  senderCompartmentId: 'ocid1.compartment.oc1..synthetic',
  fromAddress: 'sender@synthetic.invalid',
  messageIdDomain: 'mail.synthetic.invalid',
};

describe('OCI fake-client send contract (no network)', () => {
  function setup(submitEmail: jest.Mock, options: {
    claim?: number; status?: string; subscription?: string; location?: string; person?: string; retryCount?: number;
  } = {}) {
    const prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(options.claim ?? 1),
      mailJob: {
        findFirst: jest.fn().mockResolvedValue({ id: jobId, status: options.status ?? 'queued' }),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: jobId, toEmail: recipient, subject: 'Synthetic subject', body,
          retryCount: options.retryCount ?? 0,
          location: { status: options.location ?? 'active' },
          personMapping: { status: options.person ?? 'active' },
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      mailDeliveryAttempt: {
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const transaction = jest.fn(async (input: unknown) => typeof input === 'function'
      ? (input as (tx: typeof prisma) => unknown)(prisma)
      : Promise.all(input as Promise<unknown>[]));
    const db = Object.assign(prisma, { $transaction: transaction });
    const license = {
      checkTenantLicense: jest.fn().mockResolvedValue({ status: options.subscription ?? 'active' }),
      assertCanSend: jest.fn((status: string) => {
        if (!['active', 'trial'].includes(status)) throw new Error('SUBSCRIPTION_NOT_SENDABLE');
      }),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const rateLimiter = { reserve: jest.fn().mockImplementation(async (_tenant: string, _job: string, attempt: string, rfc: string) => {
      await db.mailDeliveryAttempt.update({
        where: { id: attempt, tenantId },
        data: { status: 'invoked', providerInvokedAt: new Date(), rfcMessageId: rfc },
      });
      return { admitted: true };
    }) };
    const provider = new OciEmailDeliveryProvider(config, { submitEmail } as unknown as OciSubmitClient);
    const service = new MailJobsService(db as unknown as PrismaService, license as unknown as LicenseService,
      provider, audit as unknown as AuditService, {} as never, config, rateLimiter as never);
    return { db, license, audit, rateLimiter, service };
  }

  const accepted = () => ({
    opcRequestId: 'request-synthetic',
    emailSubmittedResponse: {
      messageId: 'message@synthetic.invalid', envelopeId: 'envelope-synthetic', suppressedRecipients: [],
    },
  });

  it('uses the persisted recipient only and stores correlation IDs on the same tenant attempt', async () => {
    const submitEmail = jest.fn().mockResolvedValue(accepted());
    const { db, service, rateLimiter, audit } = setup(submitEmail);

    const result = await service.processQueuedMailJob(tenantId, jobId, null);

    expect(result).toMatchObject({ status: 'sent', provider_result: { provider: 'oci_email_delivery_https', success: true } });
    expect(submitEmail).toHaveBeenCalledTimes(1);
    const [request] = submitEmail.mock.calls[0];
    const attemptId = request.opcRequestId as string;
    expect(request).toEqual({
      opcRequestId: attemptId,
      retryConfiguration: common.NoRetryConfigurationDetails,
      submitEmailDetails: {
        messageId: `<${attemptId}@mail.synthetic.invalid>`,
        sender: { senderAddress: { email: config.fromAddress }, compartmentId: config.senderCompartmentId },
        recipients: { to: [{ email: recipient }] }, subject: 'Synthetic subject', bodyText: body,
      },
    });
    expect(db.mailJob.findFirstOrThrow).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: jobId, tenantId, status: 'processing', claimAttemptId: attemptId },
    }));
    expect(rateLimiter.reserve).toHaveBeenCalledWith(tenantId, jobId, attemptId, `<${attemptId}@mail.synthetic.invalid>`);
    expect(db.mailDeliveryAttempt.update).toHaveBeenCalledWith({
      where: { id: attemptId, tenantId },
      data: expect.objectContaining({
        status: 'succeeded', providerMessageId: 'message@synthetic.invalid',
        envelopeId: 'envelope-synthetic', opcRequestId: 'request-synthetic',
      }),
    });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(recipient);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(body);
  });

  it.each([
    { name: 'suppressed', value: () => ({ ...accepted(), emailSubmittedResponse: { ...accepted().emailSubmittedResponse, suppressedRecipients: [{ email: recipient }] } }), status: 'failed', errorCode: 'RECIPIENT_SUPPRESSED' },
    { name: '429', value: () => new common.OciError(429, 'TooManyRequests', `raw ${recipient} ${body}`, 'request-synthetic', 'email', 'SubmitEmail', '', '', ''), status: 'queued', errorCode: 'PROVIDER_TRANSIENT' },
    { name: 'quota', value: () => new common.OciError(400, 'QuotaExceeded', `raw ${recipient}`, 'request-synthetic', 'email', 'SubmitEmail', '', '', ''), status: 'queued', errorCode: 'PROVIDER_TRANSIENT' },
    { name: 'bad request', value: () => new common.OciError(400, 'InvalidParameter', `raw ${recipient}`, 'request-synthetic', 'email', 'SubmitEmail', '', '', ''), status: 'failed', errorCode: 'OCI_REQUEST_REJECTED' },
    { name: 'auth', value: () => new common.OciError(401, 'NotAuthenticated', `raw ${recipient}`, 'request-synthetic', 'email', 'SubmitEmail', '', '', ''), status: 'failed', errorCode: 'OCI_AUTH_REJECTED' },
    { name: 'forbidden', value: () => new common.OciError(403, 'NotAuthorized', `raw ${recipient}`, 'request-synthetic', 'email', 'SubmitEmail', '', '', ''), status: 'failed', errorCode: 'OCI_AUTH_REJECTED' },
    { name: 'timeout', value: () => new common.OciError(408, 'Timeout', `raw ${recipient}`, 'request-synthetic', 'email', 'SubmitEmail', '', '', ''), status: 'delivery_unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' },
    { name: 'server error', value: () => new common.OciError(500, 'InternalError', `raw ${recipient}`, 'request-synthetic', 'email', 'SubmitEmail', '', '', ''), status: 'delivery_unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' },
    { name: 'response loss', value: () => new Error(`raw ${recipient} ${body} fake-token-canary`), status: 'delivery_unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' },
    { name: 'invalid receipt', value: () => ({ ...accepted(), emailSubmittedResponse: { ...accepted().emailSubmittedResponse, envelopeId: '' } }), status: 'delivery_unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' },
  ])('$name is classified safely without an SDK retry', async ({ value, status, errorCode }) => {
    const outcome = value();
    const submitEmail = jest.fn();
    if (outcome instanceof Error) submitEmail.mockRejectedValue(outcome);
    else submitEmail.mockResolvedValue(outcome);
    const { db, service, audit } = setup(submitEmail);

    const response = await service.processQueuedMailJob(tenantId, jobId, null);

    expect(submitEmail).toHaveBeenCalledTimes(1);
    expect(response).toMatchObject({ status, provider_result: { error_message: errorCode } });
    const persisted = JSON.stringify([db.mailJob.update.mock.calls, db.mailDeliveryAttempt.update.mock.calls, audit.record.mock.calls, response]);
    for (const sensitive of [recipient, body, 'fake-token-canary', `raw ${recipient}`]) {
      expect(persisted).not.toContain(sensitive);
    }
    if (status === 'delivery_unknown') {
      db.$executeRawUnsafe.mockResolvedValue(0);
      db.mailJob.findFirst.mockResolvedValue({ id: jobId, status: 'delivery_unknown' });
      await expect(service.processQueuedMailJob(tenantId, jobId, null)).rejects.toMatchObject({ status: 409 });
      expect(submitEmail).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ['cancelled', { claim: 0, status: 'canceled' }],
    ['waiting', { claim: 0, status: 'waiting' }],
    ['other tenant', { claim: 0, status: 'absent' }],
    ['expired', { subscription: 'expired' }],
    ['suspended', { subscription: 'suspended' }],
    ['inactive location', { location: 'inactive' }],
    ['inactive person', { person: 'inactive' }],
  ] as const)('%s never reaches the fake OCI client', async (_name, options) => {
    const submitEmail = jest.fn();
    const { db, service } = setup(submitEmail, options);
    if ('status' in options && options.status === 'absent') db.mailJob.findFirst.mockResolvedValue(null);
    if ('claim' in options) {
      await expect(service.processQueuedMailJob(tenantId, jobId, null))
        .rejects.toMatchObject({ status: options.status === 'absent' ? 404 : 409 });
    } else {
      await expect(service.processQueuedMailJob(tenantId, jobId, null))
        .resolves.toMatchObject({ status: 'failed' });
    }
    expect(submitEmail).not.toHaveBeenCalled();
  });
});
