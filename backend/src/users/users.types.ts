export type ManagedOperatorResponse = {
  user_id: string;
  username: string;
  email: string | null;
  role: 'operator';
  status: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OperatorLocationAssignmentResponse = {
  operator_id: string;
  locations: Array<{
    location_id: string;
    location_code: string;
    location_name: string;
    is_active: boolean;
  }>;
};
