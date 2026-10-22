import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as argon2 from 'argon2';
import { Client } from 'pg';
import request from 'supertest';

const source = process.env.DATABASE_URL;
assert(source, 'DATABASE_URL is required');
assert(['local', 'test'].includes(process.env.APP_ENV), 'Local/CI only');
const sourceUrl = new URL(source);
assert(['localhost', '127.0.0.1'].includes(sourceUrl.hostname), 'Local PostgreSQL only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseName = `poolduck_tenant_acceptance_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
  Object.assign(process.env, {
    DATABASE_URL: testUrl.toString(), APP_ENV: 'production', NODE_ENV: 'test',
    MAIL_PROVIDER: 'mock', MAIL_JOB_PROCESSOR_ENABLED: 'false',
    DELETION_PURGE_PROCESSOR_ENABLED: 'false', TENANT_PURGE_PROCESSOR_ENABLED: 'false',
    JWT_SECRET: 'synthetic-tenant-access-secret-32chars',
    REFRESH_TOKEN_SECRET: 'synthetic-tenant-refresh-secret-32chars',
    PLATFORM_JWT_SECRET: 'synthetic-platform-access-secret-32chars',
    PLATFORM_REFRESH_TOKEN_SECRET: 'synthetic-platform-refresh-secret-32chars',
    PLATFORM_PROVISIONING_SECRET: 'synthetic-platform-provisioning-secret-32chars',
    AUTH_IDENTITY_HASH_SECRET: 'synthetic-identity-hash-secret-32chars',
  });
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../dist/app.module.js');
  const { PrismaService } = await import('../dist/prisma.service.js');
  const { PlatformTenantPurgeService } = await import('../dist/platform/platform-tenant-purge.service.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  const db = app.get(PrismaService);
  try {
    const server = app.getHttpServer();
    const platform = request.agent(server);
    const tenantAgent = request.agent(server);
    const managerPassword = 'SyntheticManagerPassword123!';
    const adminPassword = 'SyntheticPlatformPassword123!';
    await db.platformAdmin.create({ data: { email: 'platform@example.local', passwordHash: await argon2.hash(adminPassword) } });
    const makeTenant = (tenantCode, subscriptionStatus = 'trial') => db.tenant.create({ data: {
      tenantCode, name: 'Synthetic Tenant', locationLimit: 2,
      subscription: { create: { plan: 'manual', status: subscriptionStatus,
        startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000) } },
    } });
    const tenant = await makeTenant('10PDACC001');
    const other = await makeTenant('10PDACC002');
    const active = await makeTenant('10PDACC003', 'active');
    const manager = await db.user.create({ data: { tenantId: tenant.id, email: 'manager@example.local',
      passwordHash: await argon2.hash(managerPassword), role: 'tenant_manager' } });
    const location = await db.location.create({ data: { tenantId: tenant.id, locationCode: '10PDAC01', name: 'Synthetic Site' } });
    const person = await db.personMapping.create({ data: { tenantId: tenant.id, locationId: location.id,
      personCode: '01K0ACC00001', scanCode: 'E01K0ACC00001', personName: 'Synthetic Person',
      email: 'person@example.local' } });
    const oldScan = await db.scanEvent.create({ data: { tenantId: tenant.id, locationId: location.id,
      personMappingId: person.id, createdByUserId: manager.id, scanCode: person.scanCode,
      scanType: 'entry', action: 'entry', rawPayload: 'synthetic-old',
      receivedAt: new Date(Date.now() - 86_400_000), createdAt: new Date(Date.now() - 86_400_000) } });
    const oldMail = await db.mailJob.create({ data: { tenantId: tenant.id, locationId: location.id,
      personMappingId: person.id, scanEventId: oldScan.id, tenantNameSnapshot: tenant.name,
      locationNameSnapshot: location.name, personNameSnapshot: person.personName,
      personCodeSnapshot: person.personCode, toEmail: person.email, subject: 'Synthetic',
      body: 'Synthetic body', templateKey: 'synthetic', status: 'queued',
      scheduledAt: new Date(Date.now() - 1000), sendNotBefore: new Date(Date.now() - 1000) } });
    const historical = () => Promise.all([
      db.scanEvent.findUniqueOrThrow({ where: { id: oldScan.id } }),
      db.mailJob.findUniqueOrThrow({ where: { id: oldMail.id } }),
    ]);

    await request(server).post(`/api/platform/tenants/${tenant.tenantCode}/delete`)
      .send({ password: adminPassword }).expect(401);
    await platform.post('/api/platform/auth/login')
      .send({ email: 'platform@example.local', password: adminPassword }).expect(201);
    await tenantAgent.post('/api/auth/login')
      .send({ tenant_code: tenant.tenantCode, identifier: manager.email, password: managerPassword }).expect(201);
    await tenantAgent.post(`/api/platform/tenants/${tenant.tenantCode}/delete`)
      .send({ password: adminPassword }).expect(401);
    await platform.post(`/api/platform/tenants/${tenant.tenantCode}/delete`)
      .send({ password: 'wrong' }).expect(403);
    await platform.post(`/api/platform/tenants/${active.tenantCode}/delete`)
      .send({ password: adminPassword }).expect(409);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { tenantId: active.id } })).status, 'active');

    const deletion = await platform.post(`/api/platform/tenants/${tenant.tenantCode}/delete`)
      .send({ password: adminPassword }).expect(201);
    assert.equal(deletion.body.status, 'pending_delete');
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } })).status, 'suspended');
    assert.equal((await tenantAgent.get('/api/license/check').expect(200)).body.can_send, false);
    await tenantAgent.get('/api/auth/me').expect(200);
    await tenantAgent.get('/api/scan-events').expect(200);
    await tenantAgent.post('/api/scan-events')
      .send({ location_id: location.locationCode, scan_code: person.scanCode }).expect(403);
    const blockedMail = await tenantAgent.post(`/api/mail-jobs/${oldMail.id}/send`).expect(201);
    assert.equal(blockedMail.body.status, 'failed');
    assert.equal((await db.mailDeliveryAttempt.findFirstOrThrow({ where: { mailJobId: oldMail.id } })).providerInvokedAt, null);
    const historyBeforeRestore = await historical();
    const restored = await platform.post(`/api/platform/tenants/${tenant.tenantCode}/restore`).send({}).expect(201);
    assert.equal(restored.body.status, 'active');
    assert.equal(restored.body.subscription.status, 'trial');
    assert.deepEqual(await historical(), historyBeforeRestore);
    const scanResponse = await tenantAgent.post('/api/scan-events')
      .send({ location_id: location.locationCode, scan_code: person.scanCode }).expect(201);
    assert.equal(scanResponse.body.action, 'entry');

    await platform.post(`/api/platform/tenants/${tenant.tenantCode}/delete`)
      .send({ password: adminPassword }).expect(201);
    await db.$executeRaw`UPDATE tenants SET deleted_at = (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 year' - INTERVAL '1 second',
      purge_after = (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 second' WHERE id = ${tenant.id}::uuid`;
    await platform.post(`/api/platform/tenants/${tenant.tenantCode}/restore`).send({}).expect(409);
    const beforePurge = await historical();
    const purge = app.get(PlatformTenantPurgeService);
    assert.equal((await purge.purgeDueTenant(tenant.id)).outcome, 'purged');
    assert.deepEqual(await historical(), beforePurge);
    await tenantAgent.get('/api/auth/me').expect(401);
    await tenantAgent.post('/api/auth/login')
      .send({ tenant_code: tenant.tenantCode, identifier: manager.email, password: managerPassword }).expect(401);
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: other.id } })).status, 'active');

    for (const [code, priorStatus] of [['10PDACC005', 'expired'], ['10PDACC006', 'suspended']]) {
      const candidate = await makeTenant(code, priorStatus);
      await platform.post(`/api/platform/tenants/${code}/delete`)
        .send({ password: adminPassword }).expect(201);
      assert.equal((await db.subscription.findUniqueOrThrow({ where: { tenantId: candidate.id } })).status, 'suspended');
      const candidateRestore = await platform.post(`/api/platform/tenants/${code}/restore`)
        .send({}).expect(201);
      assert.equal(candidateRestore.body.subscription.status, priorStatus);
      assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: candidate.id } })).status, 'active');
    }

    process.env.APP_ENV = 'staging';
    process.env.STAGING_TENANT_DELETE_ENABLED = 'true';
    const staging = await makeTenant('10PDACC004', 'expired');
    const stagingUser = await db.user.create({ data: { tenantId: staging.id,
      email: 'staging-manager@example.local', passwordHash: await argon2.hash(managerPassword), role: 'tenant_manager' } });
    const stagingLocation = await db.location.create({ data: { tenantId: staging.id,
      locationCode: '10PDAC02', name: 'Staging Site' } });
    const stagingPerson = await db.personMapping.create({ data: { tenantId: staging.id,
      locationId: stagingLocation.id, personCode: '01K0ACC00002', scanCode: 'E01K0ACC00002',
      personName: 'Staging Person', email: 'staging-person@example.local' } });
    const stagingScan = await db.scanEvent.create({ data: { tenantId: staging.id,
      locationId: stagingLocation.id, personMappingId: stagingPerson.id,
      scanCode: stagingPerson.scanCode, scanType: 'entry', action: 'entry',
      rawPayload: 'synthetic', receivedAt: new Date() } });
    const stagingMail = await db.mailJob.create({ data: { tenantId: staging.id,
      locationId: stagingLocation.id, personMappingId: stagingPerson.id, scanEventId: stagingScan.id,
      tenantNameSnapshot: staging.name, locationNameSnapshot: stagingLocation.name,
      personNameSnapshot: stagingPerson.personName, personCodeSnapshot: stagingPerson.personCode,
      toEmail: stagingPerson.email, subject: 'Synthetic', body: 'Synthetic',
      templateKey: 'synthetic', status: 'delivery_unknown' } });
    await db.mailDeliveryAttempt.create({ data: { tenantId: staging.id, mailJobId: stagingMail.id, status: 'delivery_unknown' } });
    await db.auditLog.create({ data: { tenantId: staging.id, actorUserId: stagingUser.id,
      action: 'synthetic', resourceType: 'scan', resourceId: stagingScan.id, result: 'success' } });
    const stagingResult = await platform.post(`/api/platform/tenants/${staging.tenantCode}/delete`)
      .send({ password: adminPassword }).expect(201);
    assert.equal(stagingResult.body.status, 'deleted');
    assert.equal(await db.tenant.count({ where: { id: staging.id } }), 0);
    for (const model of ['user', 'location', 'personMapping', 'scanEvent', 'mailJob',
      'mailDeliveryAttempt', 'auditLog', 'subscription']) {
      assert.equal(await db[model].count({ where: { tenantId: staging.id } }), 0, model);
    }
    const audit = await db.platformAuditLog.findMany({ where: { resourceId: staging.id } });
    assert.equal(JSON.stringify(audit).includes('staging-person@example.local'), false);
    console.log('Tenant deletion HTTP acceptance: auth, subscription/scan/mail gates, restore, purge, staging graph passed.');
  } finally {
    await app.close();
  }
} finally {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName]);
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
