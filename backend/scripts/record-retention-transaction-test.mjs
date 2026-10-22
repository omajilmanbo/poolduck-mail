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
const databaseName = `poolduck_retention_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString() });

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
    cwd: root, env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: 'pipe',
  });
  process.env.DATABASE_URL = testUrl.toString();
  process.env.APP_ENV = 'production';
  const { PrismaService } = await import('../dist/prisma.service.js');
  const { RecordRetentionService } = await import('../dist/retention/record-retention.service.js');
  const db = new PrismaService();
  try {
    const retention = new RecordRetentionService(db);
    const boundary = await db.$queryRaw`SELECT
      (TIMESTAMP '2024-02-29 12:00:00' + INTERVAL '1 year') AS deadline,
      (TIMESTAMP '2025-02-28 12:00:00' >= TIMESTAMP '2024-02-29 12:00:00' + INTERVAL '1 year') AS due,
      (TIMESTAMP '2025-02-28 11:59:59.999' >= TIMESTAMP '2024-02-29 12:00:00' + INTERVAL '1 year') AS early`;
    assert.equal(boundary[0].deadline.toISOString(), '2025-02-28T12:00:00.000Z');
    assert.equal(boundary[0].due, true);
    assert.equal(boundary[0].early, false);

    const createTenant = (code) => db.tenant.create({ data: {
      tenantCode: code, name: 'Synthetic Tenant', locationLimit: 1,
      subscription: { create: { plan: 'manual', status: 'trial',
        startAt: new Date('2024-01-01T00:00:00Z'), endAt: new Date('2030-01-01T00:00:00Z') } },
    } });
    const tenant = await createTenant('10PDRET001');
    const other = await createTenant('10PDRET002');
    const location = await db.location.create({ data: { tenantId: tenant.id,
      locationCode: '10PDRE01', name: 'Synthetic Location' } });
    const person = await db.personMapping.create({ data: { tenantId: tenant.id, locationId: location.id,
      personCode: '01K0RET00001', scanCode: 'E01K0RET00001', personName: 'Synthetic Person',
      email: 'person@example.local' } });
    const old = new Date('2024-02-29T12:00:00Z');
    const scan = await db.scanEvent.create({ data: { tenantId: tenant.id, locationId: location.id,
      personMappingId: person.id, scanCode: person.scanCode, scanType: 'entry', rawPayload: 'synthetic',
      receivedAt: old, createdAt: old } });
    const mail = await db.mailJob.create({ data: { tenantId: tenant.id, locationId: location.id,
      personMappingId: person.id, scanEventId: scan.id, tenantNameSnapshot: tenant.name,
      locationNameSnapshot: location.name, personNameSnapshot: person.personName,
      personCodeSnapshot: person.personCode, toEmail: person.email, subject: 'Synthetic',
      body: 'Synthetic body', templateKey: 'synthetic', status: 'delivery_unknown' } });
    const attempt = await db.mailDeliveryAttempt.create({ data: { tenantId: tenant.id,
      mailJobId: mail.id, status: 'invoked' } });
    await db.scanRequestIdempotency.create({ data: { tenantId: tenant.id, route: 'scan',
      keyHash: 'a'.repeat(64), requestFingerprint: 'b'.repeat(64),
      scanEventId: scan.id, mailJobId: mail.id, expiresAt: new Date('2024-03-01T00:00:00Z') } });
    const businessAudit = await db.auditLog.create({ data: { tenantId: tenant.id,
      action: 'synthetic', resourceType: 'scan', resourceId: scan.id,
      result: 'success', metadataJson: { marker: 'synthetic' }, createdAt: old } });
    const platformAudit = await db.platformAuditLog.create({ data: { targetTenantId: tenant.id,
      action: 'platform.synthetic', resourceType: 'tenant', resourceId: tenant.id,
      result: 'success', createdAt: old } });
    const otherAudit = await db.auditLog.create({ data: { tenantId: other.id,
      action: 'synthetic', resourceType: 'tenant', resourceId: other.id,
      result: 'success', createdAt: old } });
    const waitingScan = await db.scanEvent.create({ data: { tenantId: tenant.id,
      locationId: location.id, personMappingId: person.id, scanCode: person.scanCode,
      scanType: 'entry', rawPayload: 'synthetic-waiting', receivedAt: old, createdAt: old } });
    const waitingMail = await db.mailJob.create({ data: { tenantId: tenant.id,
      locationId: location.id, personMappingId: person.id, scanEventId: waitingScan.id,
      tenantNameSnapshot: tenant.name, locationNameSnapshot: location.name,
      personNameSnapshot: person.personName, personCodeSnapshot: person.personCode,
      toEmail: person.email, subject: 'Synthetic', body: 'Synthetic body',
      templateKey: 'synthetic', status: 'waiting' } });
    for (const status of ['waiting', 'queued', 'processing']) {
      const data = status === 'queued'
        ? { status, scheduledAt: new Date(), sendNotBefore: null }
        : status === 'processing'
          ? { status, scheduledAt: null, claimedAt: new Date(), claimAttemptId: randomUUID() }
          : { status };
      await db.mailJob.update({ where: { id: waitingMail.id }, data });
      assert.equal(await retention.purgeScanFamily(tenant.id, waitingScan.id), 'blocked');
    }

    assert.equal((await retention.dueScanFamilies()).some((row) => row.id === scan.id), false);
    assert.equal(await retention.purgeScanFamily(tenant.id, scan.id), 'blocked');
    await db.mailDeliveryAttempt.update({ where: { id: attempt.id },
      data: { status: 'delivery_unknown', completedAt: new Date() } });
    assert.equal(await retention.purgeScanFamily(tenant.id, scan.id), 'blocked');
    await db.$executeRaw`UPDATE tenants SET status = 'pending_delete',
      deleted_at = clock_timestamp() AT TIME ZONE 'UTC',
      purge_after = (clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1 year',
      deleted_from_status = 'active', deleted_from_subscription_status = 'trial'
      WHERE id = ${tenant.id}::uuid`;
    await db.subscription.update({ where: { tenantId: tenant.id }, data: { status: 'suspended' } });
    assert.equal((await retention.dueScanFamilies()).some((row) => row.id === scan.id), false);
    assert.equal((await retention.dueBusinessAudits()).some((row) => row.id === businessAudit.id), false);
    assert.equal((await retention.duePlatformAudits()).some((row) => row.id === platformAudit.id), false);
    assert.equal(await retention.purgeScanFamily(tenant.id, scan.id), 'blocked');
    await db.$executeRaw`UPDATE tenants SET status = 'active', deleted_at = NULL, purge_after = NULL,
      deleted_from_status = NULL, deleted_from_subscription_status = NULL WHERE id = ${tenant.id}::uuid`;
    await db.subscription.update({ where: { tenantId: tenant.id }, data: { status: 'trial' } });
    assert.equal((await retention.dueScanFamilies()).some((row) => row.id === scan.id), true);
    assert.equal((await retention.dueScanFamilies()).some((row) => row.id === waitingScan.id), false);
    assert.equal(await retention.purgeScanFamily(other.id, scan.id), 'not_due');
    assert.equal(await db.scanEvent.count({ where: { id: scan.id } }), 1);
    // Reconciliation records call closure without rewriting the delivery fact.
    await db.mailDeliveryAttempt.update({ where: { id: attempt.id },
      data: { providerCallClosedAt: new Date() } });
    assert.equal((await retention.dueScanFamilies()).some((row) => row.id === scan.id), true);

    await db.$executeRaw`CREATE FUNCTION reject_retention_scan() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$`;
    await db.$executeRaw`CREATE TRIGGER reject_retention_scan BEFORE DELETE ON scan_events
      FOR EACH ROW EXECUTE FUNCTION reject_retention_scan()`;
    await assert.rejects(retention.purgeScanFamily(tenant.id, scan.id));
    assert.equal(await db.mailJob.count({ where: { id: mail.id } }), 1);
    assert.equal(await db.mailDeliveryAttempt.count({ where: { id: attempt.id } }), 1);
    await db.$executeRaw`DROP TRIGGER reject_retention_scan ON scan_events`;
    await db.$executeRaw`DROP FUNCTION reject_retention_scan()`;
    assert.equal(await retention.purgeScanFamily(tenant.id, scan.id), 'deleted');
    await db.mailJob.update({ where: { id: waitingMail.id }, data: { status: 'failed', scheduledAt: null } });
    assert.equal(await retention.purgeScanFamily(tenant.id, waitingScan.id), 'deleted');
    for (const model of ['scanEvent', 'mailJob', 'mailDeliveryAttempt', 'scanRequestIdempotency']) {
      assert.equal(await db[model].count({ where: { tenantId: tenant.id } }), 0);
    }
    await db.$executeRaw`CREATE FUNCTION reject_retention_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic audit rollback'; END $$`;
    await db.$executeRaw`CREATE TRIGGER reject_retention_audit BEFORE DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION reject_retention_audit()`;
    await assert.rejects(retention.purgeBusinessAudit(businessAudit.id, tenant.id));
    assert.equal(await db.auditLog.count({ where: { id: businessAudit.id } }), 1);
    await db.$executeRaw`DROP TRIGGER reject_retention_audit ON audit_logs`;
    await db.$executeRaw`DROP FUNCTION reject_retention_audit()`;
    assert.equal(await retention.purgeBusinessAudit(businessAudit.id, tenant.id), 'deleted');
    assert.equal(await retention.purgePlatformAudit(platformAudit.id, tenant.id), 'deleted');
    assert.equal(await db.auditLog.count({ where: { id: otherAudit.id } }), 1);
    const rollback = readFileSync(path.join(root, 'prisma', 'rollback',
      '20261022000000_record_retention_scan_indexes.sql'), 'utf8');
    const rollbackClient = new Client({ connectionString: testUrl.toString() });
    await rollbackClient.connect();
    try {
      await assert.rejects(rollbackClient.query(rollback), /RECORD_RETENTION_ROLLBACK_REQUIRES_EXPLICIT_GATE/);
      await rollbackClient.query('BEGIN');
      await rollbackClient.query("SET LOCAL app.allow_record_retention_index_rollback = 'true'");
      await rollbackClient.query(rollback);
      await rollbackClient.query('ROLLBACK');
      const indexes = await rollbackClient.query(`SELECT count(*)::int AS count FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'scan_events_due_at_id_idx'`);
      assert.equal(indexes.rows[0].count, 1);
    } finally {
      await rollbackClient.end();
    }
    process.env.APP_ENV = 'staging';
    await assert.rejects(retention.dueScanFamilies(), /PRODUCTION_ONLY/);
    console.log('ADR-024 retention migration, leap deadline, freeze, isolation, rollback and FK cleanup passed.');
  } finally {
    await db.$disconnect();
  }
} finally {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName]);
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
