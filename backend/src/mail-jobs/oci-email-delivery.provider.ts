import * as common from 'oci-common';
import * as emaildataplane from 'oci-emaildataplane';
import { MailProvider, MailProviderSendInput, MailProviderSendResult } from './mail-provider.types';
import { MailProviderConfig } from './mail-provider.config';
import { createAttemptMessageId } from './mail-message-id';

export type OciMailConfig = Extract<MailProviderConfig, { kind: 'oci_email_delivery_https' }>;
export type OciSubmitClient = Pick<emaildataplane.EmailDPClient, 'submitEmail'>;

export type OciMailSubmissionResult = MailProviderSendResult & {
  rfcMessageId: string;
};

function safeRequestId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    && /^[A-Za-z0-9._:/-]+$/.test(value) ? value : undefined;
}

export function classifyOciSubmitError(error: unknown): Pick<MailProviderSendResult, 'disposition' | 'errorCode' | 'opcRequestId'> {
  if (!(error instanceof common.OciError)) {
    return { disposition: 'unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN' };
  }
  const opcRequestId = safeRequestId(error.opcRequestId);
  const status = error.statusCode;
  if (status === 429 || (status === 400 && ['QuotaExceeded', 'LimitExceeded'].includes(error.serviceCode))) {
    return { disposition: 'transient', errorCode: 'OCI_QUOTA_REJECTED', opcRequestId };
  }
  if (status === 401 || status === 403) {
    return { disposition: 'permanent', errorCode: 'OCI_AUTH_REJECTED', opcRequestId };
  }
  if (status >= 400 && status < 500 && ![408, 425, 499].includes(status)) {
    return { disposition: 'permanent', errorCode: 'OCI_REQUEST_REJECTED', opcRequestId };
  }
  return { disposition: 'unknown', errorCode: 'PROVIDER_OUTCOME_UNKNOWN', opcRequestId };
}

export class OciEmailDeliveryProvider implements MailProvider {
  constructor(
    private readonly config: OciMailConfig,
    private readonly client: OciSubmitClient,
  ) {}

  // Only call this factory for an explicitly approved Staging real-mail configuration.
  // Fake clients are injected directly in Local/CI tests, so they never contact IMDS.
  static async createForStaging(config: OciMailConfig): Promise<OciEmailDeliveryProvider> {
    const authProvider = await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
    const client = new emaildataplane.EmailDPClient(
      { authenticationDetailsProvider: authProvider },
      { retryConfiguration: common.NoRetryConfigurationDetails },
    );
    client.regionId = config.region;
    return new OciEmailDeliveryProvider(config, client);
  }

  async send(input: MailProviderSendInput): Promise<OciMailSubmissionResult> {
    const rfcMessageId = createAttemptMessageId(input.attemptId, this.config.messageIdDomain);
    try {
      const response = await this.client.submitEmail({
        opcRequestId: input.attemptId,
        retryConfiguration: common.NoRetryConfigurationDetails,
        submitEmailDetails: {
          messageId: rfcMessageId,
          sender: {
            senderAddress: { email: this.config.fromAddress },
            compartmentId: this.config.senderCompartmentId,
          },
          recipients: { to: [{ email: input.toEmail }] },
          subject: input.subject,
          bodyText: input.body,
        },
      });
      const receipt = response.emailSubmittedResponse;
      if (!receipt?.messageId || receipt.messageId.length > 255
        || !receipt.envelopeId || receipt.envelopeId.length > 512
        || !safeRequestId(response.opcRequestId)
        || !Array.isArray(receipt.suppressedRecipients)) {
        throw new Error('OCI_EMAIL_SUBMIT_RESPONSE_INVALID');
      }
      const suppressed = receipt.suppressedRecipients.length > 0;
      return {
        provider: 'oci_email_delivery_https',
        success: !suppressed,
        disposition: suppressed ? 'suppressed' : 'accepted',
        ...(suppressed ? { errorCode: 'RECIPIENT_SUPPRESSED' as const } : {}),
        providerMessageId: receipt.messageId,
        rfcMessageId,
        envelopeId: receipt.envelopeId,
        opcRequestId: response.opcRequestId,
      };
    } catch (error) {
      return { provider: 'oci_email_delivery_https', success: false, rfcMessageId, ...classifyOciSubmitError(error) };
    }
  }
}
