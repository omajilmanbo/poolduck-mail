export type UnmappedScanCaseResponse = {
  case_id: string;
  scan_event_id: string;
  location_id: string | null;
  location_name: string | null;
  location_active: boolean;
  scan_code: string;
  received_at: string;
  status: string;
  handled_by_user_id: string | null;
  handled_at: string | null;
  mapping_prefill_allowed: boolean;
};
