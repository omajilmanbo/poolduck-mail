export type SendMailJobResponse = {
  mail_job_id: string;
  status: 'queued' | 'sent' | 'failed';
  retry_count: number;
  scheduled_at: string | null;
  provider_result: {
    provider: string;
    success: boolean;
    provider_message_id?: string;
    error_message?: string;
  };
};

export type MailJobHistoryItem = {
  mail_job_id: string;
  action: 'entry' | 'exit' | 'unknown';
  status: string;
  created_at: string;
  sent_at: string | null;
  error_message: string | null;
  retry_count: number;
  scheduled_at: string | null;
  context: {
    tenant_name: string;
    location_name: string;
    person_name: string;
    person_code: string;
    snapshot_source: string;
  };
  scan_event: {
    scan_event_id: string;
    location_id: string;
    location_name: string;
    person_code: string;
    action: 'entry' | 'exit' | 'unknown';
    action_source: 'person_action_code' | 'manual_adjustment' | 'legacy_unknown';
    scan_code: string;
    received_at: string;
  };
};

export type MailJobListResponse = {
  items: MailJobHistoryItem[];
  next_cursor: string | null;
};
