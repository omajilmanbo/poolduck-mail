import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mock } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import argon2 from 'argon2';
import { Client } from 'pg';
import request from 'supertest';

assert(['test', 'local'].includes(process.env.APP_ENV), 'Local/CI only');
const databaseUrl = new URL(process.env.DATABASE_URL);
assert(['postgres:', 'postgresql:'].includes(databaseUrl.protocol), 'PostgreSQL URL required');
assert(['localhost', '127.0.0.1'].includes(databaseUrl.hostname), 'Local PostgreSQL only');
assert(['', '?schema=public'].includes(databaseUrl.search), 'Only the public test schema is supported');
databaseUrl.search = '';
databaseUrl.pathname = '/postgres';
const admin = new Client({ connectionString: databaseUrl.href });
const database = 'restore_' + randomUUID().replaceAll('-', '');

// Keep the fixture's key-share lock until PostgreSQL has actually observed the restore
// waiting before the cutoff and measured a time after it. The observer never changes the row.
async function observeWaitAndRelease(reader, deadline) {
  const sampleWait = async () => {
    const { rows: [sample] } = await reader.query(`
      SELECT extract(epoch FROM ($1::timestamptz - clock_timestamp()))::float8 * 1000 AS remaining_ms,
        (
          SELECT DISTINCT pid FROM pg_locks
          WHERE NOT granted AND pg_backend_pid() = ANY(pg_blocking_pids(pid))
        ) AS waiter
    `, [deadline]);
    return sample;
  };
  try {
    let start = await sampleWait();
    while (start.waiter === null && start.remaining_ms > 0) {
      await delay(20);
      start = await sampleWait();
    }
    assert(start.waiter !== null && start.remaining_ms > 0, 'Expected a database lock wait before expiry');
    await reader.query(`
      SELECT pg_sleep(greatest(0, extract(epoch FROM ($1::timestamptz - clock_timestamp())))::float8 + 0.025)
    `, [deadline]);
    const end = await sampleWait();
    assert(end.waiter === start.waiter && end.remaining_ms < 0, 'Expected the same request still waiting after expiry');
    return { beforeMs: Math.round(start.remaining_ms), afterMs: Math.round(-end.remaining_ms) };
  } finally {
    await reader.query('ROLLBACK');
  }
}

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  databaseUrl.pathname = '/' + database;
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl.href, APP_ENV: 'test', NODE_ENV: 'test', MAIL_PROVIDER: 'mock',
    JWT_SECRET: 'synthetic-restore-test-secret',
  });
  const backend = fileURLToPath(new URL('../', import.meta.url));
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { cwd: backend });
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../dist/app.module.js');
  const { PrismaService } = await import('../dist/prisma.service.js');
  const { RESTORABLE_AT_WRITE } = await import('../dist/locations/locations.service.js');
  const { DeletionPurgeService } = await import('../dist/locations/deletion-purge.service.js');
  const { MAIL_PROVIDER_TOKEN } = await import('../dist/mail-jobs/mail-provider.config.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    await app.init();
    const db = app.get(PrismaService);
    const send = mock.method(app.get(MAIL_PROVIDER_TOKEN), 'send');

    // Evaluate the predicate used by both UPDATEs with exact UTC instants in PostgreSQL.
    const boundary = await db.$queryRaw`
      SELECT ${RESTORABLE_AT_WRITE} AS allowed
      FROM (VALUES ('pending_delete', TIMESTAMP '2030-01-15')) target(status, purge_after)
      CROSS JOIN (VALUES (TIMESTAMP '2030-01-14 23:59:59.999'),
                         (TIMESTAMP '2030-01-15 00:00:00.000'),
                         (TIMESTAMP '2030-01-15 00:00:00.001')) write_clock(utc_now)
      ORDER BY write_clock.utc_now
    `;
    assert.deepEqual(boundary.map(row => row.allowed), [true, false, false]);

    const password = 'SyntheticRestore123!';
    const passwordHash = await argon2.hash(password);
    async function login(tenant, role) {
      const email = `${role}@example.local`;
      const username = role === 'operator' ? 'restore-operator' : null;
      const user = await db.user.create({ data: { tenantId: tenant.id, role, email, username, passwordHash } });
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/auth/login').send({ tenant_code: tenant.tenantCode, identifier: email, password }).expect(201);
      return { agent, user };
    }
    const tenant = await db.tenant.create({ data: { tenantCode: '10PD224001', name: 'Restore A', locationLimit: 3 } });
    const other = await db.tenant.create({ data: { tenantCode: '10PD224002', name: 'Restore B', locationLimit: 1 } });
    const manager = await login(tenant, 'tenant_manager');
    const operator = await login(tenant, 'operator');
    const foreign = await login(other, 'tenant_manager');
    const location = await db.location.create({ data: {
      tenantId: tenant.id, locationCode: '10PD2241', name: 'Restore office',
    } });
    const person = await db.personMapping.create({ data: {
      tenantId: tenant.id, locationId: location.id, personCode: '01K0ABC22401', scanCode: '01K0ABC22401',
      personName: 'Restore fixture', email: 'restore@example.local',
    } });
    const scope = { tenantId: tenant.id, locationId: location.id, personMappingId: person.id };
    const scan = await db.scanEvent.create({ data: {
      ...scope, scanCode: person.scanCode, scanType: 'barcode', action: 'entry',
      rawPayload: 'E' + person.personCode, receivedAt: new Date(),
    } });
    const historicalMail = await db.mailJob.create({ data: {
      ...scope, scanEventId: scan.id, tenantNameSnapshot: tenant.name, locationNameSnapshot: location.name,
      personNameSnapshot: person.personName, personCodeSnapshot: person.personCode, toEmail: person.email,
      subject: 'Fixture', body: 'Fixture', templateKey: 'synthetic', status: 'canceled',
    } });
    const locationPath = '/api/locations/' + location.locationCode;
    const personPath = locationPath + '/people/' + person.personCode;

    await manager.agent.post(personPath + '/delete').expect(201);
    for (const denied of [operator, foreign]) {
      const result = await denied.agent.post(personPath + '/restore').expect(404);
      assert.equal(result.body.code, 'LOCATION_NOT_FOUND');
    }
    await db.operatorLocationAssignment.create({ data: {
      tenantId: tenant.id, operatorId: operator.user.id, locationId: location.id,
    } });
    await manager.agent.post(locationPath + '/delete').expect(201);
    await operator.agent.post(locationPath + '/restore').expect(403);
    assert.equal((await foreign.agent.post(locationPath + '/restore').expect(404)).body.code, 'LOCATION_NOT_FOUND');
    assert.equal((await operator.agent.post(personPath + '/restore').expect(404)).body.code, 'LOCATION_NOT_FOUND');
    await manager.agent.post(locationPath + '/restore').expect(201);

    // Exercise people first so the location stays active until the person's tombstone is verified.
    for (const target of [
      { route: personPath, row: person, model: db.personMapping, actor: operator,
        type: 'person_mapping', code: person.personCode, missing: 'PERSON_MAPPING_NOT_FOUND' },
      { route: locationPath, row: location, model: db.location, actor: manager,
        type: 'location', code: location.locationCode, missing: 'LOCATION_NOT_FOUND' },
    ]) {
      const { route, actor, model, row, type, code, missing } = target;
      const where = { id: row.id };
      if (type === 'location') await actor.agent.post(route + '/delete').expect(201);
      for (const state of ['active', 'inactive']) {
        if (state === 'inactive') {
          await actor.agent.delete(route).expect(200);
          await actor.agent.post(route + '/delete').expect(201);
        }
        const restored = await actor.agent.post(route + '/restore').expect(201);
        assert.equal(restored.body.is_active, state === 'active');
        assert.equal(restored.body.purge_after, null);
        assert.equal(restored.body.deleted_at, null);
        assert.equal(restored.body.deletion_status, null);
        assert.deepEqual(await model.findUniqueOrThrow({ where, select: {
          status: true, deletedAt: true, purgeAfter: true, deletedFromStatus: true,
        } }), { status: state, deletedAt: null, purgeAfter: null, deletedFromStatus: null });
        assert.equal((await actor.agent.post(route + '/restore').expect(404)).body.code, missing);
      }

      if (type === 'location') await actor.agent.post(route + '/reactivate').expect(201);
      await actor.agent.post(route + '/delete').expect(201);
      const reader = new Client({ connectionString: databaseUrl.href });
      await reader.connect();
      let expired;
      let timing;
      try {
        const [window] = await db.$queryRaw`
          SELECT date_trunc('milliseconds', clock_timestamp()) + interval '2 seconds' AS deadline
        `;
        expired = await model.update({ where, data: {
          deletedAt: new Date(window.deadline.getTime() - 14 * 86_400_000), purgeAfter: window.deadline,
        } });
        assert.equal(expired.status, 'pending_delete');
        assert.equal(expired.deletedFromStatus, type === 'location' ? 'active' : 'inactive');
        await reader.query('BEGIN');
        const fixtureRead = type === 'location'
          ? 'SELECT id FROM locations WHERE tenant_id = $1 AND id = $2 FOR KEY SHARE'
          : 'SELECT id FROM person_mappings WHERE tenant_id = $1 AND id = $2 FOR KEY SHARE';
        assert.equal((await reader.query(fixtureRead, [tenant.id, row.id])).rowCount, 1);
        const [response, observed] = await Promise.all([
          actor.agent.post(route + '/restore'),
          observeWaitAndRelease(reader, window.deadline),
        ]);
        assert.equal(response.status, 409);
        assert.equal(response.body.code, 'DELETION_RESTORE_EXPIRED');
        assert.deepEqual(await model.findUniqueOrThrow({ where }), expired);
        timing = observed;
      } finally {
        await reader.end();
      }
      const auditWhere = { tenantId: tenant.id, actorUserId: actor.user.id, resourceType: type, resourceId: code };
      const expiredAudit = { ...auditWhere, action: type + '.restore_expired' };
      assert.equal(await db.auditLog.count({ where: { ...expiredAudit, result: 'denied' } }), 1);
      assert.deepEqual(await db.mailJob.findMany(), [historicalMail]);
      assert.equal(await db.mailDeliveryAttempt.count(), 0);
      assert.equal(send.mock.callCount(), 0);
      console.log(`${type}: waiting ${timing.beforeMs} ms before deadline, lock held ${timing.afterMs} ms past it; `
        + `409, pending_delete (was ${expired.deletedFromStatus}), one denied audit, one unchanged job, zero attempts/calls.`);

      // A fresh request after expiry receives the same error before the purge worker runs.
      const rejection = await actor.agent.post(route + '/restore').expect(409);
      assert.equal(rejection.body.code, 'DELETION_RESTORE_EXPIRED');
      assert.deepEqual(await model.findUniqueOrThrow({ where }), expired);
      const denied = await db.auditLog.findMany({ where: expiredAudit });
      assert.equal(denied.length, 2);
      for (const event of denied) {
        assert.equal(event.result, 'denied');
        assert.deepEqual(event.metadataJson, type === 'location' ? {} : { location_id: location.locationCode });
      }
      const successes = await db.auditLog.findMany({ where: { ...auditWhere, action: type + '.restored' } });
      assert.equal(successes.length, type === 'location' ? 3 : 2);
      for (const success of successes) {
        assert.equal(success.result, 'success');
        assert.deepEqual(success.metadataJson, { location_id: location.locationCode });
      }
      await app.get(DeletionPurgeService).processDueDeletions();
      const tombstone = await model.findUniqueOrThrow({ where });
      assert.equal(tombstone.status, 'purged');
      assert.equal((await actor.agent.post(route + '/restore').expect(404)).body.code, missing);
      assert.deepEqual(await model.findUniqueOrThrow({ where }), tombstone);
    }
    assert.deepEqual(await db.mailJob.findMany(), [historicalMail]);
    assert.equal(await db.mailDeliveryAttempt.count(), 0);
    assert.equal(send.mock.callCount(), 0);
    console.log('Restore SQL boundaries, authorized API, denials, audits, tombstones and zero mail effects passed.');
  } finally {
    await app.close();
  }
} finally {
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
  await admin.end();
}
