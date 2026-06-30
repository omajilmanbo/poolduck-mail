export type MailProviderSendInput = {
  mailJobId: string;
  toEmail: string;
  subject: string;
  body: string;
};

export type MailProviderSendResult = {
  provider: string;
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
};

export interface MailProvider {
  send(input: MailProviderSendInput): Promise<MailProviderSendResult>;
}
