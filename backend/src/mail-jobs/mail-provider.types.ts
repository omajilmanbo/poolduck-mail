export type MailProviderSendInput = {
  mailJobId: string;
  attemptId: string;
  toEmail: string;
  subject: string;
  body: string;
};

export type MailProviderSendResult = {
  provider: string;
  success: boolean;
  disposition?: 'accepted' | 'transient' | 'permanent' | 'suppressed' | 'unknown';
  errorCode?: 'PROVIDER_TRANSIENT' | 'OCI_QUOTA_REJECTED' | 'OCI_AUTH_REJECTED' | 'OCI_REQUEST_REJECTED' | 'RECIPIENT_SUPPRESSED' | 'PROVIDER_OUTCOME_UNKNOWN';
  providerMessageId?: string;
  envelopeId?: string;
  opcRequestId?: string;
  errorMessage?: string;
};

export interface MailProvider {
  send(input: MailProviderSendInput): Promise<MailProviderSendResult>;
}
