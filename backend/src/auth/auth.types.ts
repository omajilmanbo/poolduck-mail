export type AuthTokenPayload = {
  sub: string;
  user_id: string;
  tenant_id: string;
  role: string;
  session_id?: string;
  token_type?: 'access' | 'refresh';
};

export type AuthenticatedUserResponse = {
  user_id: string;
  tenant_id: string;
  tenant_code?: string;
  username: string | null;
  email: string | null;
  role: string;
};

export type PublicAuthenticatedUserResponse = Omit<
  AuthenticatedUserResponse,
  'tenant_id' | 'tenant_code'
> & {
  tenant_code: string;
};

export type AuthenticatedRequest = {
  auth?: AuthenticatedUserResponse;
};

export type UserRole = 'tenant_manager' | 'operator';
