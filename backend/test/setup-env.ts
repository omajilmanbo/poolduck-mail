process.env.DATABASE_URL ??=
  'postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS ??= '900';
process.env.JWT_REFRESH_TOKEN_TTL_SECONDS ??= '604800';
process.env.NODE_ENV = 'test';
process.env.PLATFORM_JWT_SECRET ??= 'test-platform-jwt-secret';
process.env.PLATFORM_REFRESH_TOKEN_SECRET ??= 'test-platform-refresh-secret';
process.env.PLATFORM_PROVISIONING_SECRET ??=
  'test-platform-provisioning-secret-at-least-32';
