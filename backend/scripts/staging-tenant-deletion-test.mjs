import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as argon2 from 'argon2';
import { Client } from 'pg';

const source = process.env.DATABASE_URL;
assert(source, 'DATABASE_URL is required');
assert(['local', 'test'].includes(process.env.APP_ENV), 'Local/CI only');
const sourceUrl = new URL(source);
assert(['localhost', '127.0.0.1'].includes(sourceUrl.hostname), 'Local PostgreSQL only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseName = `poolduck_staging_delete_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
  process.env.APP_ENV = 'staging';
  process.env.STAGING_TENANT_DELETE_ENABLED = 'true';
  const { PrismaService } = await import('../dist/prisma.service.js');
  const { PlatformAuditService } = await import('../dist/platform/platform-audit.service.js');
  const { PlatformTenantsService } = await import('../dist/platform/platform-tenants.service.js');
  const db = new PrismaService();
  try {
    const service = new PlatformTenantsService(db, new PlatformAuditService(db));
    const password = 'synthetic-password';
    const platformAdmin = await db.platformAdmin.create({ data: {
      email: 'platform@example.local', passwordHash: await argon2.hash(password),
    } });
    const platformSession = await db.platformSession.create({ data: {
      platformAdminId: platformAdmin.id, identityVersionSnapshot: platformAdmin.identityVersion,
      refreshTokenHash: 'e'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000),
    } });
    const actor = { platform_admin_id: platformAdmin.id, identity_version: platformAdmin.identityVersion,
      session_id: platformSession.id, email_masked: 'p***m@example.local' };
    const makeTenant = (code, status = 'trial') => db.tenant.create({ data: {
      tenantCode: code, name: 'Synthetic Tenant', locationLimit: 2,
      subscription: { create: { plan: 'manual', status,
        startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000) } },
    } });
    const target = await makeTenant('10PDSTG001');
    const other = await makeTenant('10PDSTG002');
    const active = await makeTenant('10PDSTG003', 'active');
    const manager = await db.user.create({ data: { tenantId: target.id,
      email: 'manager@example.local', passwordHash: 'synthetic-hash', role: 'tenant_manager' } });
    const operator = await db.user.create({ data: { tenantId: target.id,
      username: 'syntheticop', email: 'operator@example.local', passwordHash: 'synthetic-hash', role: 'operator' } });
    const device = await db.device.create({ data: { tenantId: target.id, deviceCode: 'device-1', name: 'Device' } });
    const location = await db.location.create({ data: { tenantId: target.id, locationCode: '10PDST01', name: 'Site' } });
    const person = await db.personMapping.create({ data: { tenantId: target.id, locationId: location.id,
      personCode: '01K0STG00001', scanCode: 'E01K0STG00001', personName: 'Person', email: 'person@example.local' } });
    await db.operatorLocationAssignment.create({ data: { tenantId: target.id, operatorId: operator.id, locationId: location.id } });
    await db.locationLegacyIdentifier.create({ data: { tenantId: target.id, locationId: location.id,
      legacyCode: 'legacy-site', legacyType: 'old' } });
    await db.session.create({ data: { tenantId: target.id, userId: manager.id,
      refreshTokenHash: 'c'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000) } });
    const scan = await db.scanEvent.create({ data: { tenantId: target.id, deviceId: device.id,
      locationId: location.id, personMappingId: person.id, createdByUserId: manager.id,
      scanCode: person.scanCode, scanType: 'entry', action: 'entry', rawPayload: 'synthetic', receivedAt: new Date() } });
    const mail = await db.mailJob.create({ data: { tenantId: target.id, locationId: location.id,
      personMappingId: person.id, scanEventId: scan.id, tenantNameSnapshot: 'Synthetic Tenant',
      locationNameSnapshot: 'Site', personNameSnapshot: 'Person', personCodeSnapshot: person.personCode,
      toEmail: 'person@example.local', subject: 'Synthetic', body: 'Synthetic', templateKey: 'synthetic', status: 'delivery_unknown' } });
    await db.mailDeliveryAttempt.create({ data: { tenantId: target.id, mailJobId: mail.id, status: 'delivery_unknown' } });
    await db.auditLog.create({ data: { tenantId: target.id, actorUserId: manager.id,
      action: 'synthetic', resourceType: 'scan', resourceId: scan.id, result: 'success' } });
    await db.scanRequestIdempotency.create({ data: { tenantId: target.id, route: 'scan',
      keyHash: 'a'.repeat(64), requestFingerprint: 'b'.repeat(64), scanEventId: scan.id,
      mailJobId: mail.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    await db.platformTenantIdempotency.create({ data: { keyHash: 'd'.repeat(64), requestFingerprint: 'f'.repeat(64),
      platformAdminId: platformAdmin.id, tenantId: target.id, expiresAt: new Date(Date.now() + 86_400_000) } });
    await db.platformAuditLog.create({ data: { platformAdminId: platformAdmin.id,
      targetTenantId: target.id, action: 'synthetic', resourceType: 'tenant', resourceId: target.id,
      result: 'success' } });

    await assert.rejects(service.deleteTenant(actor, target.tenantCode, { password: 'wrong' }));
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: target.id } })).status, 'active');
    await assert.rejects(service.deleteTenant(actor, active.tenantCode, { password }));
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { tenantId: active.id } })).status, 'active');
    process.env.APP_ENV = 'production';
    process.env.STAGING_TENANT_DELETE_ENABLED = 'false';
    await assert.rejects(service.purgeStagingTenant(target.id, platformAdmin.id, 'synthetic-hash'));
    assert.equal(await db.scanEvent.count({ where: { tenantId: target.id } }), 1);
    process.env.APP_ENV = 'staging';
    await assert.rejects(service.deleteTenant(actor, target.tenantCode, { password }));
    process.env.STAGING_TENANT_DELETE_ENABLED = 'true';

    await db.$executeRaw`CREATE FUNCTION reject_synthetic_delete() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$`;
    await db.$executeRaw`CREATE TRIGGER reject_synthetic_delete BEFORE DELETE ON tenants
      FOR EACH ROW EXECUTE FUNCTION reject_synthetic_delete()`;
    await assert.rejects(service.deleteTenant(actor, target.tenantCode, { password }));
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: target.id } })).status, 'staging_deleting');
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { tenantId: target.id } })).status, 'suspended');
    assert.equal(await db.mailJob.count({ where: { tenantId: target.id } }), 1);
    await assert.rejects(db.user.update({ where: { id: manager.id }, data: { email: 'rewrite@example.local' } }));
    await db.$executeRaw`DROP TRIGGER reject_synthetic_delete ON tenants`;
    await db.$executeRaw`DROP FUNCTION reject_synthetic_delete()`;

    const deleted = await service.deleteTenant(actor, target.tenantCode, { password });
    assert.equal(deleted.status, 'deleted');
    assert.equal(deleted.purge_after, null);
    assert.equal(await db.tenant.count({ where: { id: target.id } }), 0);
    for (const model of ['user', 'device', 'location', 'personMapping', 'session',
      'operatorLocationAssignment', 'locationLegacyIdentifier', 'scanEvent', 'mailJob',
      'mailDeliveryAttempt', 'scanRequestIdempotency', 'auditLog', 'subscription',
      'platformTenantIdempotency']) {
      assert.equal(await db[model].count({ where: { tenantId: target.id } }), 0, model);
    }
    assert.equal(await db.platformAuditLog.count({ where: { targetTenantId: target.id } }), 0);
    assert.equal((await service.deleteTenant(actor, target.tenantCode, { password })).idempotency_replayed, true);
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: other.id } })).name, 'Synthetic Tenant');
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { tenantId: other.id } })).status, 'trial');
    const logs = await db.platformAuditLog.findMany({ where: { resourceId: target.id } });
    assert.equal(logs.filter((row) => row.action === 'platform.tenant.staging_deleted').length, 1);
    assert.equal(JSON.stringify(logs).includes('person@example.local'), false);
    assert.equal(JSON.stringify(logs).includes('Synthetic Tenant'), false);
    console.log('Staging tenant deletion auth, compensation, full FK graph, replay, and isolation passed.');
  } finally {
    await db.$disconnect();
  }
} finally {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName]);
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
