export type LocationResponse = {
  location_id: string;
  location_code: string;
  location_name: string;
  type: string;
  is_active: boolean;
  deletion_status: 'scheduled' | null;
  deleted_at: string | null;
  purge_after: string | null;
};

export type PersonMappingResponse = {
  person_id: string;
  person_code: string;
  person_name: string;
  scan_code: string;
  email_masked: string;
  is_active: boolean;
  deletion_status: 'scheduled' | null;
  deleted_at: string | null;
  purge_after: string | null;
};

export type PersonMappingDetailResponse = PersonMappingResponse & {
  location_id: string;
  email: string;
};
