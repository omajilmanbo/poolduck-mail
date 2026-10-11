import * as common from 'oci-common';
import {
  OciEmailDeliveryProvider,
  OciMailConfig,
  OciSubmitClient,
  classifyOciSubmitError,
} from '../src/mail-jobs/oci-email-delivery.provider';
import { createAttemptMessageId } from '../src/mail-jobs/mail-message-id';

const config: OciMailConfig = {
  kind: 'oci_email_delivery_https',
  region: 'ap-tokyo-1',
  senderCompartmentId: 'ocid1.compartment.oc1..synthetic',
  fromAddress: 'sender@example.com',
  messageIdDomain: 'mail.example.com',
};
const input = {
  mailJobId: '44444444-4444-4444-8444-444444444444',
  attemptId: '11111111-1111-4111-8111-111111111111',
  toEmail: 'recipient@example.com',
  subject: 'Synthetic subject',
  body: 'Synthetic plain text',
};

describe('OCI Email Delivery submission adapter', () => {
  it('maps one immutable recipient, plain text and opaque Message-ID with no SDK retry', async () => {
    const submitEmail = jest.fn().mockResolvedValue({
      opcRequestId: 'oci-request-synthetic',
      emailSubmittedResponse: {
        messageId: 'accepted@mail.example.com',
        envelopeId: 'envelope-synthetic',
        suppressedRecipients: [],
      },
    });
    const provider = new OciEmailDeliveryProvider(config, { submitEmail } as unknown as OciSubmitClient);

    const result = await provider.send(input);

    expect(submitEmail).toHaveBeenCalledTimes(1);
    expect(submitEmail).toHaveBeenCalledWith({
      opcRequestId: input.attemptId,
      retryConfiguration: common.NoRetryConfigurationDetails,
      submitEmailDetails: {
        messageId: `<${input.attemptId}@mail.example.com>`,
        sender: {
          senderAddress: { email: 'sender@example.com' },
          compartmentId: config.senderCompartmentId,
        },
        recipients: { to: [{ email: 'recipient@example.com' }] },
        subject: 'Synthetic subject',
        bodyText: 'Synthetic plain text',
      },
    });
    expect(result).toEqual({
      provider: 'oci_email_delivery_https',
      success: true,
      disposition: 'accepted',
      providerMessageId: 'accepted@mail.example.com',
      rfcMessageId: `<${input.attemptId}@mail.example.com>`,
      envelopeId: 'envelope-synthetic',
      opcRequestId: 'oci-request-synthetic',
    });
    expect(JSON.stringify(submitEmail.mock.calls)).not.toContain(input.mailJobId);
  });

  it('reports suppression without returning recipient addresses', async () => {
    const submitEmail = jest.fn().mockResolvedValue({
      opcRequestId: 'oci-request-synthetic',
      emailSubmittedResponse: {
        messageId: 'accepted@mail.example.com',
        envelopeId: 'envelope-synthetic',
        suppressedRecipients: [{ email: input.toEmail }],
      },
    });
    const provider = new OciEmailDeliveryProvider(config, { submitEmail } as unknown as OciSubmitClient);

    const result = await provider.send(input);

    expect(result).toMatchObject({ success: false, disposition: 'suppressed', errorCode: 'RECIPIENT_SUPPRESSED' });
    expect(JSON.stringify(result)).not.toContain(input.toEmail);
  });

  it('classifies a transport failure as unknown without a second SDK call or raw response persistence', async () => {
    const failure = new Error('synthetic transport failure');
    const submitEmail = jest.fn().mockRejectedValue(failure);
    const provider = new OciEmailDeliveryProvider(config, { submitEmail } as unknown as OciSubmitClient);

    await expect(provider.send(input)).resolves.toMatchObject({
      success: false, disposition: 'unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN',
    });
    expect(submitEmail).toHaveBeenCalledTimes(1);
  });

  it('classifies incomplete or oversized correlation receipts as unknown', async () => {
    const submitEmail = jest.fn().mockResolvedValue({
      opcRequestId: 'r'.repeat(513),
      emailSubmittedResponse: {
        messageId: 'accepted@mail.example.com', envelopeId: 'envelope-synthetic',
        suppressedRecipients: [],
      },
    });
    const provider = new OciEmailDeliveryProvider(config, { submitEmail } as unknown as OciSubmitClient);

    await expect(provider.send(input)).resolves.toMatchObject({
      success: false, disposition: 'unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN',
    });
    expect(submitEmail).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, 'TooManyRequests', 'transient', 'PROVIDER_TRANSIENT'],
    [400, 'QuotaExceeded', 'transient', 'PROVIDER_TRANSIENT'],
    [400, 'LimitExceeded', 'transient', 'PROVIDER_TRANSIENT'],
    [400, 'InvalidParameter', 'permanent', 'OCI_REQUEST_REJECTED'],
    [401, 'NotAuthenticated', 'permanent', 'OCI_AUTH_REJECTED'],
    [403, 'NotAuthorized', 'permanent', 'OCI_AUTH_REJECTED'],
    [408, 'Timeout', 'unknown', 'PROVIDER_OUTCOME_UNKNOWN'],
    [500, 'InternalError', 'unknown', 'PROVIDER_OUTCOME_UNKNOWN'],
  ])('classifies OCI %s/%s as %s', async (status, serviceCode, disposition, errorCode) => {
    const failure = new common.OciError(status as number, serviceCode as string,
      `sensitive recipient ${input.toEmail}`, 'request-synthetic', 'email', 'SubmitEmail', '', '', '');
    const submitEmail = jest.fn().mockRejectedValue(failure);
    const provider = new OciEmailDeliveryProvider(config, { submitEmail } as unknown as OciSubmitClient);

    const result = await provider.send(input);

    expect(result).toMatchObject({ success: false, disposition, errorCode, opcRequestId: 'request-synthetic' });
    expect(JSON.stringify(result)).not.toContain(input.toEmail);
    expect(submitEmail).toHaveBeenCalledTimes(1);
  });

  it('drops unsafe request IDs and treats untyped errors as unknown', () => {
    const failure = new common.OciError(429, 'TooManyRequests', 'sensitive', 'id\r\nunsafe', 'email', 'SubmitEmail', '', '', '');
    expect(classifyOciSubmitError(failure)).toEqual({
      disposition: 'transient', errorCode: 'PROVIDER_TRANSIENT', opcRequestId: undefined,
    });
    expect(classifyOciSubmitError({ statusCode: 429, message: 'untrusted' })).toEqual({
      disposition: 'unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN',
    });
  });

  it('rejects non-opaque attempt identifiers before submitting', async () => {
    const submitEmail = jest.fn();
    const provider = new OciEmailDeliveryProvider(config, { submitEmail } as unknown as OciSubmitClient);

    await expect(provider.send({ ...input, attemptId: 'tenant-person-code' })).rejects.toThrow('MAIL_ATTEMPT_ID_INVALID');
    expect(submitEmail).not.toHaveBeenCalled();
    expect(createAttemptMessageId(input.attemptId, config.messageIdDomain))
      .toBe(`<${input.attemptId}@mail.example.com>`);
  });
});
