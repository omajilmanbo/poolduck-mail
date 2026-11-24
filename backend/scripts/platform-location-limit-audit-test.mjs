import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import argon2 from 'argon2';
import { Client } from 'pg';

const ownerUrl = new URL(process.env.DATABASE_URL);
assert.equal(ownerUrl.protocol, 'postgresql:');
assert.equal(ownerUrl.hostname, '127.0.0.1', 'A loopback test database is required');
assert(ownerUrl.port, 'An explicit PostgreSQL port is required');
assert.equal(ownerUrl.pathname, '/poolduck_quota_209', 'Use the disposable #209 database');
// pg parses query parameters as connection options, so pass it only the URL authority and path.
assert(!/[?#]/.test(ownerUrl.href), 'DATABASE_URL must not contain a query or fragment');
assert.equal(process.env.APP_ENV, 'test');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.MAIL_PROVIDER, 'mock');
assert.equal(process.env.REAL_MAIL_SEND_ENABLED, 'false');

const database = new Client({ connectionString: ownerUrl.toString() });
const appRole = 'poolduck_quota_209_app';
const appPassword = randomBytes(24).toString('hex');
const email = 'quota-admin@smoke.example.local';
const password = randomBytes(24).toString('base64url');
const tenantCode = '10PFABC001';
const action = 'platform.location_limit.update';
await database.connect();
let app;
try {
  const { rows: [counts] } = await database.query(`
    SELECT (SELECT count(*)::int FROM tenants) AS tenants,
           (SELECT count(*)::int FROM platform_admins) AS admins
  `);
  assert.deepEqual(counts, { tenants: 0, admins: 0 }, 'A fresh test fixture is required');
  await database.query(`CREATE ROLE ${appRole} LOGIN PASSWORD '${appPassword}'`);
  await database.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${appRole}`);
  await database.query(`GRANT UPDATE ON platform_admins, platform_sessions, tenants TO ${appRole}`);
  await database.query(`GRANT INSERT ON platform_sessions, platform_audit_logs TO ${appRole}`);
  const { rows: [admin] } = await database.query(`
    INSERT INTO platform_admins (email, password_hash, updated_at)
    VALUES ($1, $2, now()) RETURNING id
  `, [email, await argon2.hash(password)]);
  const { rows: [tenant, neighbor] } = await database.query(`
    INSERT INTO tenants (tenant_code, name, location_limit, platform_version, updated_at)
    VALUES ($1, 'Synthetic Quota Tenant', 3, 2, now()),
           ('10PFABC002', 'Synthetic Neighbor', 1, 1, now()) RETURNING id
  `, [tenantCode]);
  await database.query(`
    INSERT INTO locations (tenant_id, location_code, name, status, updated_at)
    VALUES ($1, '10ABC001', 'Synthetic Active', 'active', now()),
           ($1, '10ABC002', 'Synthetic Inactive', 'inactive', now()),
           ($2, '10ABC001', 'Synthetic Neighbor Site', 'active', now())
  `, [tenant.id, neighbor.id]);

  const appUrl = new URL(ownerUrl);
  appUrl.username = appRole;
  appUrl.password = appPassword;
  process.env.DATABASE_URL = appUrl.toString();
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.PLATFORM_JWT_SECRET = randomBytes(32).toString('hex');
  process.env.PLATFORM_REFRESH_TOKEN_SECRET = randomBytes(32).toString('hex');
  process.env.PLATFORM_PROVISIONING_SECRET = randomBytes(32).toString('hex');
  const { AppModule } = await import('../dist/app.module.js');
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();
  const login = await fetch(`${baseUrl}/api/platform/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(login.status, 201);
  const cookie = login.headers.getSetCookie().map((value) => value.split(';', 1)[0]).join('; ');
  assert(cookie);
  await login.json();

  async function patch(limit, version) {
    const requestId = randomUUID();
    const response = await fetch(`${baseUrl}/api/platform/tenants/${tenantCode}/location-limit`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId, Cookie: cookie },
      body: JSON.stringify({ location_limit: limit, version }),
    });
    const { rows } = await database.query(`
      SELECT platform_admin_id, target_tenant_id, request_id, action, resource_type, resource_id,
             result, metadata_json FROM platform_audit_logs WHERE request_id = $1
    `, [requestId]);
    return { status: response.status, body: await response.json(), requestId, rows };
  }

  function assertAudit(attempt, result, metadata) {
    assert.deepEqual(attempt.rows, [{
      platform_admin_id: admin.id, target_tenant_id: tenant.id, request_id: attempt.requestId,
      action, resource_type: 'tenant', resource_id: tenant.id, result, metadata_json: metadata,
    }]);
  }

  async function assertQuotaState(limit, version) {
    const { rows } = await database.query(`
      SELECT t.location_limit, t.platform_version,
             (SELECT count(*)::int FROM locations l WHERE l.tenant_id = t.id AND l.status <> 'purged') AS usage
      FROM tenants t ORDER BY t.tenant_code
    `);
    assert.deepEqual(rows, [
      { location_limit: limit, platform_version: version, usage: 2 },
      { location_limit: 1, platform_version: 1, usage: 1 },
    ]);
  }

  const denials = [
    { code: 'PLATFORM_VERSION_CONFLICT', message: '数据已被其他操作更新，请刷新后重试' },
    { code: 'LOCATION_LIMIT_BELOW_CURRENT_USAGE', message: 'location_limit 不能低于当前计数' },
  ];
  for (const auditWritable of [true, false]) {
    if (!auditWritable) {
      await database.query(`REVOKE INSERT ON platform_audit_logs FROM ${appRole}`);
      const { rows: [privileges] } = await database.query(
        "SELECT has_table_privilege($1, 'platform_audit_logs', 'INSERT') AS can_insert", [appRole],
      );
      assert.equal(privileges.can_insert, false);
    }
    for (const [index, rejection] of denials.entries()) {
      const attempt = await patch(1, 1 + index);
      assert.equal(attempt.status, 409);
      assert.deepEqual(attempt.body, rejection);
      if (auditWritable) assertAudit(attempt, 'denied', { reason: rejection.code });
      else assert.deepEqual(attempt.rows, []);
      await assertQuotaState(3, 2);
      console.log(`409 ${rejection.code} | ${attempt.rows.length} audit row(s) | quota state verified`);
    }
  }

  await database.query(`GRANT INSERT ON platform_audit_logs TO ${appRole}`);
  const success = await patch(4, 2);
  assert.equal(success.status, 200);
  assert.equal(success.body.location_limit, 4);
  assert.equal(success.body.platform_version, 3);
  assertAudit(success, 'success', { old_limit: 3, new_limit: 4, new_version: 3 });
  await assertQuotaState(4, 3);
  const { rows: [final] } = await database.query(`
    SELECT (SELECT count(*)::int FROM platform_audit_logs WHERE action = $1) AS quota_audits,
           (SELECT count(*)::int FROM mail_jobs) AS mail_jobs,
           (SELECT count(*)::int FROM mail_delivery_attempts) AS mail_attempts
  `, [action]);
  assert.deepEqual(final, { quota_audits: 3, mail_jobs: 0, mail_attempts: 0 });
  console.log('200 | one success audit | final quota state and zero mail activity verified');
} finally {
  try {
    await app?.close();
  } finally {
    await database.end();
  }
}
