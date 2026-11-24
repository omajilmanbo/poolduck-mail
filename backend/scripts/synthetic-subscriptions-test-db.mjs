import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export function syntheticSeedDatabaseUrls(source) {
  assert(URL.canParse(source), 'DATABASE_URL must be a valid PostgreSQL URL');
  const input = new URL(source);
  assert(['postgres:', 'postgresql:'].includes(input.protocol), 'PostgreSQL URL required');
  assert(['localhost', '127.0.0.1'].includes(input.hostname), 'Local PostgreSQL only');
  assert(input.port !== '0', 'PostgreSQL port must be between 1 and 65535');
  const parameters = input.searchParams;
  assert(parameters.size === 0 || (parameters.size === 1 && parameters.get('schema') === 'public'),
    'DATABASE_URL accepts only the optional schema=public parameter');

  // Rebuild both targets without importing options or the source database name.
  const adminUrl = new URL('postgresql://127.0.0.1:5432/postgres');
  adminUrl.port = input.port || '5432';
  adminUrl.username = input.username;
  adminUrl.password = input.password;

  const databaseName = `poolduck_seed_test_${randomUUID().replaceAll('-', '')}`;
  const databaseUrl = new URL(adminUrl);
  databaseUrl.pathname = `/${databaseName}`;
  return { adminUrl, databaseName, databaseUrl };
}
