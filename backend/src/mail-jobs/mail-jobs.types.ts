export type SendMailJobResponse = {
  mail_job_id: string;
  status: 'sent' | 'failed';
  provider_result: {
    provider: string;
    success: boolean;
    provider_message_id?: string;
    error_message?: string;
  };
};
