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
const databaseName = `poolduck_purge_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
  const { PlatformAuditService } = await import('../dist/platform/platform-audit.service.js');
  const { PlatformTenantPurgeService } = await import('../dist/platform/platform-tenant-purge.service.js');
  const db = new PrismaService();
  try {
    const service = new PlatformTenantPurgeService(db, new PlatformAuditService(db));
    const makeTenant = (tenantCode) => db.tenant.create({ data: {
      tenantCode, name: 'Synthetic Tenant', locationLimit: 2,
      subscription: { create: { plan: 'manual', status: 'trial',
        startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000) } },
    } });
    const tenant = await makeTenant('10PDPRG001');
    const other = await makeTenant('10PDPRG002');
    const manager = await db.user.create({ data: { tenantId: tenant.id, email: 'manager@example.local',
      passwordHash: 'synthetic-hash', role: 'tenant_manager' } });
    const operator = await db.user.create({ data: { tenantId: tenant.id, username: 'syntheticop',
      email: 'operator@example.local', passwordHash: 'synthetic-hash', role: 'operator' } });
    const device = await db.device.create({ data: { tenantId: tenant.id, deviceCode: 'operator-device',
      name: 'Operator Device', status: 'active' } });
    const location = await db.location.create({ data: { tenantId: tenant.id, locationCode: '10PDPR01', name: 'Site Name' } });
    const person = await db.personMapping.create({ data: { tenantId: tenant.id, locationId: location.id,
      personCode: '01K0PRG00001', scanCode: 'E01K0PRG00001', personName: 'Person Name', email: 'person@example.local' } });
    const pendingLocation = await db.location.create({ data: { tenantId: tenant.id,
      locationCode: '10PDPR02', name: 'Pending Site', status: 'pending_delete',
      deletedAt: new Date(), purgeAfter: new Date(Date.now() + 86_400_000), deletedFromStatus: 'inactive' } });
    const alreadyPurgedPerson = await db.personMapping.create({ data: { tenantId: tenant.id,
      locationId: pendingLocation.id, personCode: '01K0PRG00002', scanCode: 'E01K0PRG00002',
      personName: '[deleted person]', email: 'deleted@invalid.local', status: 'purged' } });
    await db.operatorLocationAssignment.create({ data: { tenantId: tenant.id, operatorId: operator.id, locationId: location.id } });
    await db.locationLegacyIdentifier.create({ data: { tenantId: tenant.id, locationId: location.id,
      legacyCode: 'legacy-site', legacyType: 'old' } });
    await db.session.create({ data: { tenantId: tenant.id, userId: manager.id,
      refreshTokenHash: 'c'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000) } });
    const scan = await db.scanEvent.create({ data: { tenantId: tenant.id, deviceId: device.id,
      locationId: location.id, personMappingId: person.id, createdByUserId: manager.id,
      scanCode: person.scanCode, scanType: 'entry', action: 'entry', rawPayload: 'synthetic-payload', receivedAt: new Date() } });
    const mail = await db.mailJob.create({ data: { tenantId: tenant.id, locationId: location.id,
      personMappingId: person.id, scanEventId: scan.id, tenantNameSnapshot: 'Synthetic Tenant',
      locationNameSnapshot: 'Site Name', personNameSnapshot: 'Person Name', personCodeSnapshot: person.personCode,
      toEmail: 'person@example.local', subject: 'Synthetic', body: 'Synthetic body',
      templateKey: 'synthetic', status: 'delivery_unknown' } });
    await db.mailDeliveryAttempt.create({ data: { tenantId: tenant.id, mailJobId: mail.id,
      status: 'delivery_unknown', providerMessageId: 'synthetic-provider-id', completedAt: new Date() } });
    await db.auditLog.create({ data: { tenantId: tenant.id, actorUserId: manager.id,
      action: 'synthetic', resourceType: 'scan', resourceId: scan.id, result: 'success',
      metadataJson: { historical: 'Person Name' } } });
    await db.scanRequestIdempotency.create({ data: { tenantId: tenant.id, route: 'scan',
      keyHash: 'a'.repeat(64), requestFingerprint: 'b'.repeat(64), scanEventId: scan.id,
      mailJobId: mail.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    const adminAccount = await db.platformAdmin.create({ data: { email: 'admin@example.local', passwordHash: 'synthetic-hash' } });
    await db.platformTenantIdempotency.create({ data: { keyHash: 'd'.repeat(64), requestFingerprint: 'e'.repeat(64),
      platformAdminId: adminAccount.id, tenantId: tenant.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    const historical = async () => ({
      scan: await db.scanEvent.findUniqueOrThrow({ where: { id: scan.id } }),
      mail: await db.mailJob.findUniqueOrThrow({ where: { id: mail.id } }),
      attempt: await db.mailDeliveryAttempt.findFirstOrThrow({ where: { mailJobId: mail.id } }),
      audit: await db.auditLog.findFirstOrThrow({ where: { tenantId: tenant.id } }),
    });
    const beforeHistory = await historical();

    // Deadline not reached: no current or historical mutations.
    await db.$executeRaw`UPDATE tenants SET status = 'pending_delete',
      deleted_at = (clock_timestamp() AT TIME ZONE 'UTC'),
      purge_after = (clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1 year',
      deleted_from_status = 'active', deleted_from_subscription_status = 'trial'
      WHERE id = ${tenant.id}::uuid`;
    await db.subscription.update({ where: { tenantId: tenant.id }, data: { status: 'suspended' } });
    assert.equal((await service.purgeDueTenant(tenant.id)).outcome, 'not_due');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: manager.id } })).email, 'manager@example.local');

    await db.$executeRaw`UPDATE tenants SET deleted_at = (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 year' - INTERVAL '1 second',
      purge_after = (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 second' WHERE id = ${tenant.id}::uuid`;
    await db.mailDeliveryAttempt.updateMany({ where: { mailJobId: mail.id }, data: { completedAt: null } });
    await assert.rejects(service.purgeDueTenant(tenant.id), /TENANT_PURGE_MAIL_IN_FLIGHT/);
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status, 'pending_delete');
    await db.mailDeliveryAttempt.updateMany({ where: { mailJobId: mail.id }, data: { completedAt: new Date() } });
    await db.$executeRaw`CREATE FUNCTION reject_synthetic_purge() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status = 'purged' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN NEW; END $$`;
    await db.$executeRaw`CREATE TRIGGER reject_synthetic_purge BEFORE UPDATE ON tenants
      FOR EACH ROW EXECUTE FUNCTION reject_synthetic_purge()`;
    await assert.rejects(service.purgeDueTenant(tenant.id));
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status, 'pending_delete');
    assert.equal(await db.session.count({ where: { tenantId: tenant.id } }), 1);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: manager.id } })).email, 'manager@example.local');
    assert.deepEqual(await historical(), beforeHistory);
    await db.$executeRaw`DROP TRIGGER reject_synthetic_purge ON tenants`;
    await db.$executeRaw`DROP FUNCTION reject_synthetic_purge()`;

    const result = await service.purgeDueTenant(tenant.id);
    assert.equal(result.outcome, 'purged');
    assert.deepEqual(result.counts, { users: 2, devices: 1, people: 2, locations: 2,
      assignments: 1, legacy_identifiers: 1, sessions: 1,
      scan_idempotencies: 1, attempts: 1, mail_jobs: 1,
      scan_events: 1, audit_logs: 1, platform_idempotencies: 1 });
    assert.equal((await service.purgeDueTenant(tenant.id)).outcome, 'already_purged');
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).tenantCode, tenant.tenantCode);
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status, 'purged');
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } })).status, 'suspended');
    const afterManager = await db.user.findUniqueOrThrow({ where: { id: manager.id } });
    const afterOperator = await db.user.findUniqueOrThrow({ where: { id: operator.id } });
    assert.equal(afterManager.status, 'purged');
    assert.match(afterManager.email, /^purged\+[0-9a-f]{32}@invalid\.local$/);
    assert.equal(afterManager.passwordHash, '!purged');
    assert.equal(afterOperator.username, operator.id.replaceAll('-', ''));
    assert.equal(afterOperator.email, null);
    assert.equal((await db.device.findUniqueOrThrow({ where: { id: device.id } })).status, 'purged');
    assert.equal((await db.personMapping.findUniqueOrThrow({ where: { id: person.id } })).personCode, person.personCode);
    assert.equal((await db.personMapping.findUniqueOrThrow({ where: { id: alreadyPurgedPerson.id } })).status, 'purged');
    assert.equal((await db.location.findUniqueOrThrow({ where: { id: location.id } })).locationCode, location.locationCode);
    assert.equal((await db.location.findUniqueOrThrow({ where: { id: pendingLocation.id } })).deletedFromStatus, null);
    for (const model of ['session', 'operatorLocationAssignment', 'locationLegacyIdentifier',
      'scanRequestIdempotency', 'platformTenantIdempotency']) {
      assert.equal(await db[model].count({ where: { tenantId: tenant.id } }), 0);
    }
    for (const model of ['scanEvent', 'mailJob', 'mailDeliveryAttempt', 'auditLog']) {
      assert.equal(await db[model].count({ where: { tenantId: tenant.id } }), 0);
    }
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: other.id } })).name, 'Synthetic Tenant');
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { tenantId: other.id } })).status, 'trial');
    await assert.rejects(db.user.update({ where: { id: manager.id }, data: { email: 'rewritten@example.local' } }));
    await assert.rejects(db.device.update({ where: { id: device.id }, data: { name: 'Rewritten Device' } }));
    await assert.rejects(db.location.update({ where: { id: location.id }, data: { name: 'Rewritten Site' } }));
    await assert.rejects(db.personMapping.update({ where: { id: person.id }, data: { email: 'rewritten@example.local' } }));
    await assert.rejects(db.session.create({ data: { tenantId: tenant.id, userId: manager.id,
      refreshTokenHash: 'f'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000) } }));
    await assert.rejects(makeTenant(tenant.tenantCode));
    const otherLocation = await db.location.create({ data: { tenantId: other.id, locationCode: '10PDPR03', name: 'Other Site' } });
    await assert.rejects(db.personMapping.create({ data: { tenantId: other.id, locationId: otherLocation.id,
      personCode: person.personCode, scanCode: person.scanCode, personName: 'Other Person',
      email: 'other@example.local' } }));
    const audits = await db.platformAuditLog.findMany({ where: { targetTenantId: tenant.id } });
    assert.equal(audits.filter((row) => row.action === 'platform.tenant.purged').length, 1);
    assert.equal(JSON.stringify(audits).includes('manager@example.local'), false);
    assert.equal(JSON.stringify(audits).includes('Person Name'), false);
    process.env.APP_ENV = 'staging';
    await assert.rejects(service.purgeDueTenant(other.id), /PRODUCTION_ONLY/);
    console.log('Production tenant tombstone transaction, record destruction, rollback, retry, and isolation passed.');
  } finally {
    await db.$disconnect();
  }
} finally {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName]);
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
