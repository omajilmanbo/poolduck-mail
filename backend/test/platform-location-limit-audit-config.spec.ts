import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const loopbackUrl = 'postgresql://quota_owner@127.0.0.1:55432/poolduck_quota_209';
const connectMarker = 'LOCAL_QUOTA_TEST_CONNECT_REACHED';
const fixtureWithStub = `
  import { Client } from 'pg';
  Client.prototype.connect = () => { throw new Error('${connectMarker}'); };
  await import('./scripts/platform-location-limit-audit-test.mjs');
`;

function runFixture(databaseUrl: string) {
  const attempt = spawnSync(process.execPath, ['--input-type=module', '--eval', fixtureWithStub], {
    cwd: resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      APP_ENV: 'test',
      NODE_ENV: 'test',
      MAIL_PROVIDER: 'mock',
      REAL_MAIL_SEND_ENABLED: 'false',
    },
  });
  expect(attempt.error).toBeUndefined();
  expect(attempt.status).toBe(1);
  return attempt.stderr;
}

describe('platform location quota PostgreSQL fixture connection', () => {
  it.each(['?host=127.0.0.1', '?port=1', '?%68ost=127.0.0.1', '?dbname=another_fixture', '?', '#'])(
    'rejects URL suffix %j before pg.Client.connect',
    (suffix) => {
      const output = runFixture(loopbackUrl + suffix);
      expect(output).toContain('AssertionError [ERR_ASSERTION]: DATABASE_URL must not contain a query or fragment');
      expect(output).not.toContain(connectMarker);
    },
  );

  it('rejects an implicit port before pg.Client.connect', () => {
    const output = runFixture(loopbackUrl.replace(':55432', ''));
    expect(output).toContain('AssertionError [ERR_ASSERTION]: An explicit PostgreSQL port is required');
    expect(output).not.toContain(connectMarker);
  });

  it('lets an explicit query-free loopback URL reach the connection stub', () => {
    expect(runFixture(loopbackUrl)).toContain(`Error: ${connectMarker}`);
  });
});
