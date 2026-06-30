export type CreateScanEventResponse = {
  scan_event_id: string;
  mail_job_id: string;
  mail_subject: string;
  status: 'queued';
};
