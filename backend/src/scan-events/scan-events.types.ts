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
  status: 'queued' | 'processing' | 'sent' | 'failed';
  retry_count: number;
  scheduled_at: string | null;
  error_message: string | null;
  deduplicated: boolean;
};

export type ScanHistoryStatus =
  | 'unmapped'
  | 'queued'
  | 'processing'
  | 'sent'
  | 'failed';

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
  mail_job: null | {
    mail_job_id: string;
    status: string;
    action: ScanAction;
    sent_at: string | null;
    error_message: string | null;
  };
};

export type ScanEventListResponse = {
  items: ScanEventHistoryItem[];
  next_cursor: string | null;
};
