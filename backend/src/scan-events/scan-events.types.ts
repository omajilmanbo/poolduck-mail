export type ScanAction = 'entry' | 'exit' | 'unknown';
export type ScanActionSource =
  | 'person_action_code'
  | 'manual_adjustment'
  | 'legacy_unknown';

export type CreateScanEventResponse = {
  scan_event_id: string;
  mail_job_id: string;
  mail_subject: string;
  person_code: string;
  action: Exclude<ScanAction, 'unknown'>;
  action_source: ScanActionSource;
  status: ScanHistoryStatus;
  effective_status: 'active' | 'canceled';
  mail_status: ScanHistoryStatus;
  can_cancel: boolean;
  cancel_until: string | null;
  server_time: string;
  canceled_at: string | null;
  retry_count: number;
  scheduled_at: string | null;
  error_message: string | null;
  deduplicated: boolean;
};

export type ScanHistoryStatus =
  | 'waiting'
  | 'queued'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'canceled'
  | 'delivery_unknown';

export type ScanEventHistoryItem = {
  scan_event_id: string;
  location_id: string | null;
  location_name: string | null;
  person_code: string | null;
  person_name: string | null;
  scan_code: string;
  scan_type: string;
  action: ScanAction;
  action_source: ScanActionSource;
  received_at: string;
  status: ScanHistoryStatus;
  effective_status: 'active' | 'canceled';
  mail_status: ScanHistoryStatus;
  can_cancel: boolean;
  cancel_until: string | null;
  server_time: string;
  canceled_at: string | null;
  mail_job: null | {
    mail_job_id: string;
    status: string;
    action: ScanAction;
    sent_at: string | null;
    error_message: string | null;
  };
};

export type CancelScanEventResponse = {
  scan_event_id: string;
  mail_job_id: string;
  effective_status: 'canceled';
  mail_status: 'canceled';
  canceled_at: string;
  server_time: string;
};

export type ScanEventListResponse = {
  items: ScanEventHistoryItem[];
  next_cursor: string | null;
};
