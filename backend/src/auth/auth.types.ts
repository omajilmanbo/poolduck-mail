export type AuthTokenPayload = {
  sub: string;
  user_id: string;
  tenant_id: string;
  role: string;
};

export type AuthenticatedUserResponse = {
  user_id: string;
  tenant_id: string;
  email: string;
  role: string;
};

export type AuthenticatedRequest = {
  auth?: AuthenticatedUserResponse;
};

export type UserRole = 'root_admin' | 'manager';
