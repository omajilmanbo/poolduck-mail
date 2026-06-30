export type LocationResponse = {
  location_id: string;
  location_code: string;
  location_name: string;
  type: string;
  is_active: boolean;
};

export type PersonMappingResponse = {
  person_id: string;
  person_name: string;
  scan_code: string;
  email_masked: string;
  is_active: boolean;
};
