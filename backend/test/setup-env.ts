process.env.DATABASE_URL ??=
  'postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail';
process.env.JWT_SECRET ??= 'test-jwt-secret';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS ??= '86400';
