import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const source = process.env.DATABASE_URL;
assert(source, 'DATABASE_URL is required');
assert(['local', 'test'].includes(process.env.APP_ENV), 'Local/CI only');
const sourceUrl = new URL(source);
assert(['localhost', '127.0.0.1'].includes(sourceUrl.hostname), 'Local PostgreSQL only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `poolduck_rollback_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString() });
const rollback = (version) => readFileSync(path.join(root, 'prisma', 'rollback', `${version}.sql`), 'utf8');

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${name}`;
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
    cwd: root, env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: 'pipe',
  });
  const db = new Client({ connectionString: testUrl.toString() });
  await db.connect();
  try {
    const tenantId = randomUUID();
    await db.query(`INSERT INTO tenants (id, tenant_code, name, status, location_limit, updated_at)
      VALUES ($1, '10PDRBK001', 'Synthetic', 'staging_deleting', 1, CURRENT_TIMESTAMP)`, [tenantId]);
    await assert.rejects(db.query(rollback('20261020020000_guard_staging_tenant_deletion')),
      /staging deletion guard rollback blocked/);
    await db.query('ROLLBACK');
    assert.equal((await db.query('SELECT status FROM tenants WHERE id = $1', [tenantId])).rows[0].status, 'staging_deleting');
    await db.query("UPDATE tenants SET status = 'active' WHERE id = $1", [tenantId]);
    await db.query(rollback('20261020020000_guard_staging_tenant_deletion'));
    await db.query(`UPDATE tenants SET status = 'pending_delete',
      deleted_at = TIMESTAMP '2024-02-29 12:00:00',
      purge_after = TIMESTAMP '2024-02-29 12:00:00' + INTERVAL '1 year',
      deleted_from_status = 'active', deleted_from_subscription_status = 'trial'
      WHERE id = $1`, [tenantId]);
    await assert.rejects(db.query(rollback('20261020010000_guard_purged_tenant_current_writes')),
      /tenant current-write guard rollback blocked/);
    await db.query('ROLLBACK');
    await assert.rejects(db.query(rollback('20261020000000_add_tenant_deletion_lifecycle')),
      /tenant lifecycle rollback blocked/);
    await db.query('ROLLBACK');
    await db.query(`UPDATE tenants SET status = 'active', deleted_at = NULL,
      purge_after = NULL, deleted_from_status = NULL,
      deleted_from_subscription_status = NULL WHERE id = $1`, [tenantId]);
    await db.query(rollback('20261020010000_guard_purged_tenant_current_writes'));
    await db.query(rollback('20261020000000_add_tenant_deletion_lifecycle'));
    const columns = await db.query(`SELECT column_name FROM information_schema.columns
      WHERE table_name = 'tenants' AND column_name = 'purge_after'`);
    assert.equal(columns.rowCount, 0);
    console.log('Tenant deletion migration rollback blocks live deletion states and succeeds on synthetic cleared state.');
  } finally {
    await db.end();
  }
} finally {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.end();
}
