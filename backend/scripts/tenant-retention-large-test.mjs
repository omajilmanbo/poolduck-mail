import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const source = process.env.DATABASE_URL;
assert(source, 'DATABASE_URL is required');
assert(['local', 'test'].includes(process.env.APP_ENV), 'Local/CI only');
const sourceUrl = new URL(source);
assert(['localhost', '127.0.0.1'].includes(sourceUrl.hostname), 'Local PostgreSQL only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = `poolduck_retention_large_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString() });
const families = 25_000; // Four linked records each: 100,000 synthetic rows.

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(sourceUrl);
  url.pathname = `/${name}`;
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
    cwd: root, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe',
  });
  process.env.DATABASE_URL = url.toString();
  process.env.APP_ENV = 'production';
  const { PrismaService } = await import('../dist/prisma.service.js');
  const { PlatformAuditService } = await import('../dist/platform/platform-audit.service.js');
  const { PlatformTenantPurgeService } = await import('../dist/platform/platform-tenant-purge.service.js');
  const db = new PrismaService();
  try {
    const target = await db.tenant.create({ data: { tenantCode: '10PDLRG001', name: 'Synthetic Target',
      locationLimit: 1, subscription: { create: { plan: 'manual', status: 'suspended',
        startAt: new Date('2024-01-01T00:00:00Z'), endAt: new Date('2025-01-01T00:00:00Z') } } } });
    const other = await db.tenant.create({ data: { tenantCode: '10PDLRG002', name: 'Synthetic Other',
      locationLimit: 1, subscription: { create: { plan: 'manual', status: 'trial',
        startAt: new Date('2024-01-01T00:00:00Z'), endAt: new Date('2030-01-01T00:00:00Z') } } } });
    const location = await db.location.create({ data: { tenantId: target.id,
      locationCode: '10PDLR01', name: 'Synthetic Location' } });
    const person = await db.personMapping.create({ data: { tenantId: target.id, locationId: location.id,
      personCode: '01K0LRG00001', scanCode: 'E01K0LRG00001', personName: 'Synthetic Person',
      email: 'person@example.local' } });
    const sql = new Client({ connectionString: url.toString() });
    await sql.connect();
    try {
      const scanId = "('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid";
      const mailId = "('00000000-0000-4001-8000-' || lpad(to_hex(g), 12, '0'))::uuid";
      const attemptId = "('00000000-0000-4002-8000-' || lpad(to_hex(g), 12, '0'))::uuid";
      const idemId = "('00000000-0000-4003-8000-' || lpad(to_hex(g), 12, '0'))::uuid";
      await sql.query(`INSERT INTO scan_events
        (id, tenant_id, location_id, person_mapping_id, scan_code, scan_type,
          raw_payload, received_at, created_at)
        SELECT ${scanId}, $1::uuid, $2::uuid, $3::uuid, 'synthetic-' || g,
          'entry', 'synthetic', TIMESTAMP '2024-01-01', TIMESTAMP '2024-01-01'
        FROM generate_series(1, ${families}) g`, [target.id, location.id, person.id]);
      await sql.query(`INSERT INTO mail_jobs
        (id, tenant_id, location_id, person_mapping_id, scan_event_id,
          tenant_name_snapshot, location_name_snapshot, person_name_snapshot,
          person_code_snapshot, to_email, subject, body, template_key, status, updated_at)
        SELECT ${mailId}, $1::uuid, $2::uuid, $3::uuid, ${scanId},
          'Synthetic Target', 'Synthetic Location', 'Synthetic Person', '01K0LRG00001',
          'person@example.local', 'Synthetic', 'Synthetic body', 'synthetic', 'sent', CURRENT_TIMESTAMP
        FROM generate_series(1, ${families}) g`, [target.id, location.id, person.id]);
      await sql.query(`INSERT INTO mail_delivery_attempts
        (id, tenant_id, mail_job_id, status, completed_at)
        SELECT ${attemptId}, $1::uuid, ${mailId}, 'succeeded', CURRENT_TIMESTAMP
        FROM generate_series(1, ${families}) g`, [target.id]);
      await sql.query(`INSERT INTO scan_request_idempotency
        (id, tenant_id, route, key_hash, request_fingerprint, scan_event_id, mail_job_id, expires_at)
        SELECT ${idemId}, $1::uuid, 'scan', md5('key-' || g) || md5('key2-' || g),
          md5('fingerprint-' || g) || md5('fingerprint2-' || g),
          ${scanId}, ${mailId}, TIMESTAMP '2024-01-02'
        FROM generate_series(1, ${families}) g`, [target.id]);
    } finally {
      await sql.end();
    }
    await db.$executeRaw`UPDATE tenants SET status = 'pending_delete',
      deleted_at = TIMESTAMP '2024-01-01', purge_after = TIMESTAMP '2025-01-01',
      deleted_from_status = 'active', deleted_from_subscription_status = 'trial'
      WHERE id = ${target.id}::uuid`;
    const service = new PlatformTenantPurgeService(db, new PlatformAuditService(db));
    const result = await service.purgeDueTenant(target.id);
    assert.equal(result.outcome, 'purged');
    assert.equal(result.counts.scan_events, families);
    assert.equal(result.counts.mail_jobs, families);
    assert.equal(result.counts.attempts, families);
    assert.equal(result.counts.scan_idempotencies, families);
    for (const model of ['scanEvent', 'mailJob', 'mailDeliveryAttempt', 'scanRequestIdempotency']) {
      assert.equal(await db[model].count({ where: { tenantId: target.id } }), 0);
    }
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: other.id } })).name, 'Synthetic Other');
    console.log(`ADR-024 large tenant purge passed: ${families * 4} synthetic linked rows destroyed.`);
  } finally {
    await db.$disconnect();
  }
} finally {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
  await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.end();
}
