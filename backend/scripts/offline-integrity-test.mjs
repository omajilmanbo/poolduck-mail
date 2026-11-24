import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const cli = fileURLToPath(new URL('./offline-integrity.mjs', import.meta.url));
const zeros = { person_location_tenant: 0, person_code_groups: 0, lifecycle_rows: 0, history_rows: 0 };

function expectCheck(label, url, expected) {
  const child = spawnSync(process.execPath, [cli], {
    env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8', timeout: 30000,
  });
  const violations = expected && Object.values(expected).some((n) => n > 0);
  const code = expected ? (violations ? 1 : 0) : 2;
  const result = expected ? { result: violations ? 'violations' : 'ok', counts: { ...zeros, ...expected } }
    : { result: 'unavailable' };
  assert.equal(child.status, code, label);
  assert.ok(child.stderr === '', label + ' emitted diagnostics');
  assert.ok(child.stdout.trim() === JSON.stringify(result), label + ' returned unexpected output');
}

// Never run fixture DDL in the database passed by the caller. Do not forward URL
// options which could override the verified loopback host or generated database.
assert.ok(['local', 'test'].includes(process.env.APP_ENV), 'Local/CI only');
const base = new URL(process.env.DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(base.protocol) &&
  ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Local PostgreSQL only');
base.search = '';
base.pathname = '/postgres';
const admin = new Client({ connectionString: base.href });
await admin.connect();
try {
  await withDatabase(migratedHistory);
  await withDatabase(counterexamples);
  expectCheck('missing configuration', '', null);
  expectCheck('unreachable database', new URL('/missing_' + randomUUID(), base).href, null);
  console.log('Offline integrity checks passed (migrated history, synthetic faults, unavailable).');
} finally {
  await admin.end();
}

async function withDatabase(test) {
  const name = 'poolduck_integrity_' + randomUUID().replaceAll('-', '');
  const url = new URL('/' + name, base);
  await admin.query('CREATE DATABASE ' + name);
  try {
    const db = new Client({ connectionString: url.href });
    try {
      await db.connect();
      await test(db, url.href);
    } finally {
      await db.end();
    }
  } finally {
    await admin.query('DROP DATABASE ' + name);
  }
}

async function migratedHistory(db, url) {
  const root = new URL('../prisma/migrations/', import.meta.url);
  const migrations = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const name of migrations) {
    await db.query(await readFile(new URL(name + '/migration.sql', root), 'utf8'));
    if (name === '20260622000000_init') {
      await db.query(`
        INSERT INTO tenants (name, updated_at) VALUES ('fixture', now());
        INSERT INTO locations (tenant_id, location_code, name, type, updated_at)
          SELECT id, 'old-site', 'fixture', 'office', now() FROM tenants;
        INSERT INTO person_mappings (tenant_id, location_id, scan_code, person_name, email, updated_at)
          SELECT tenant_id, id, 'old-code', 'fixture', 'fixture@example.invalid', now() FROM locations;
        INSERT INTO scan_events (tenant_id, location_id, scan_code, scan_type, raw_payload, received_at)
          SELECT tenant_id, location_id, scan_code, 'entry', 'old-payload', now() FROM person_mappings;
        INSERT INTO mail_jobs (tenant_id, scan_event_id, to_email, subject, body, template_key, status, updated_at)
          SELECT tenant_id, id, 'fixture@example.invalid', 'old', 'old', 'old', 'sent', now() FROM scan_events;
      `);
    }
  }
  const { rows } = await db.query(`SELECT count(*)::int AS backfilled FROM scan_events s
    JOIN mail_jobs j ON j.scan_event_id = s.id WHERE s.action = 'unknown'
    AND s.action_source = 'legacy_unknown' AND j.context_snapshot_source = 'legacy_backfill'`);
  assert.equal(rows[0].backfilled, 1);
  expectCheck('actual migrated scan and mail', url, {});
  await db.query('DELETE FROM mail_jobs');
  expectCheck('lost job of backfilled successful scan', url, { history_rows: 1 });
}

async function counterexamples(db, url) {
  const [ddl, seed] = (await readFile(new URL('./offline-integrity-fixture.sql', import.meta.url), 'utf8'))
    .split('-- Reset fixture rows');
  await db.query(ddl);
  await db.query(seed);
  expectCheck('tombstones, nullable history, pending windows', url, {});

  // The owner of this temporary database can assume pg_database_owner. That
  // role owns the public schema but initially has no rights on our tables.
  const reader = new URL(url);
  reader.searchParams.set('options', '-c role=pg_database_owner');
  expectCheck('missing SELECT privilege', reader.href, null);
  await db.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO pg_database_owner');
  expectCheck('read-only role', reader.href, {});
  await db.query(`ALTER TABLE person_mappings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY only_one_tenant ON person_mappings FOR SELECT USING (tenant_id=1)`);
  expectCheck('partial tenant visibility', reader.href, null);

  // Each case starts with the same data in the independent fixture database.
  const cases = [
    ['wrong tenant', 'UPDATE person_mappings SET tenant_id=1 WHERE id=201', { person_location_tenant: 1 }],
    ['missing location', 'UPDATE person_mappings SET location_id=99 WHERE id=201', { person_location_tenant: 1 }],
    ['missing tenant across history', 'DELETE FROM fixture_tenants WHERE id=1',
      { person_location_tenant: 2, history_rows: 6 }],
    ['duplicate across tenants including tombstone', "UPDATE person_mappings SET person_code='fixture-a' WHERE id=201", { person_code_groups: 1 }],
    ['illegal lifecycle fields', `UPDATE locations SET purge_after=NULL WHERE id=21;
      UPDATE locations SET deleted_at=now() WHERE id=11;
      UPDATE person_mappings SET purge_after=deleted_at WHERE id=200;
      UPDATE person_mappings SET deleted_from_status=NULL WHERE id=202;
      UPDATE person_mappings SET status='unexpected' WHERE id=201;
      UPDATE locations SET deleted_from_status='active' WHERE id=20`, { lifecycle_rows: 6 }],
    ['cross-location scan', 'UPDATE scan_events SET person_mapping_id=101 WHERE id=1', { history_rows: 2 }],
    ['orphaned legacy mapping', 'UPDATE scan_events SET person_mapping_id=NULL WHERE id=2', { history_rows: 2 }],
    ['retired unmapped', "UPDATE scan_events SET scan_type='unmapped' WHERE id=2", { history_rows: 1 }],
    ['wrong job person', 'UPDATE mail_jobs SET person_mapping_id=101 WHERE id=1', { history_rows: 1 }],
    ['missing job and orphan children', 'DELETE FROM mail_jobs WHERE id=1', { history_rows: 3 }],
    ['multiple jobs on new scan', 'INSERT INTO mail_jobs VALUES (4,1,10,100,1)', { history_rows: 1 }],
    ['foreign and orphan children', `UPDATE mail_delivery_attempts SET tenant_id=2;
      UPDATE scan_request_idempotency SET scan_event_id=3;
      INSERT INTO mail_jobs VALUES (4,1,10,100,99)`, { history_rows: 3 }],
    ['foreign optional device', 'UPDATE scan_events SET device_id=2 WHERE id=1', { history_rows: 1 }],
    ['foreign optional creator', 'UPDATE scan_events SET created_by_user_id=2 WHERE id=1', { history_rows: 1 }],
    ['dangling optional canceler', 'UPDATE scan_events SET canceled_by_user_id=99 WHERE id=1', { history_rows: 1 }],
    ['destroyed family', `DELETE FROM scan_request_idempotency; DELETE FROM mail_delivery_attempts;
      DELETE FROM mail_jobs WHERE id=1; DELETE FROM scan_events WHERE id=1`, {}],
  ];
  for (const [label, change, counts] of cases) {
    await db.query(seed);
    await db.query(change);
    expectCheck(label, url, counts);
  }
  await db.query('ALTER TABLE mail_delivery_attempts RENAME TO unavailable_attempts');
  expectCheck('incomplete schema', url, null);
}
