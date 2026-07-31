export type PlatformTokenPayload = {
  sub: string;
  platform_admin_id: string;
  identity_version: number;
  session_id: string;
  token_type: 'access' | 'refresh';
  aud: 'poolduck-platform';
};

export type AuthenticatedPlatformAdmin = {
  platform_admin_id: string;
  email_masked: string;
  identity_version: number;
  session_id: string;
};

export type PlatformAuthenticatedRequest = {
  platformAuth?: AuthenticatedPlatformAdmin;
};
