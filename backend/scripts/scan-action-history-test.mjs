import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { Client } from 'pg';
import request from 'supertest';
import { NestFactory } from '@nestjs/core';
import { syntheticSeedDatabaseUrls } from './synthetic-subscriptions-test-db.mjs';

// Exercise the actual HTTP guards and SQL against a newly created, disposable database.
assert(['test', 'local'].includes(process.env.APP_ENV));
const { adminUrl, databaseName, databaseUrl } = syntheticSeedDatabaseUrls(process.env.DATABASE_URL);
const admin = new Client({ connectionString: adminUrl.toString() });
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  try {
    Object.assign(process.env, {
      DATABASE_URL: databaseUrl.toString(), APP_ENV: 'test', NODE_ENV: 'test',
      MAIL_PROVIDER: 'mock', REAL_MAIL_SEND_ENABLED: 'false', MAIL_JOB_PROCESSOR_ENABLED: 'false',
      JWT_SECRET: 'synthetic-scan-history-test-secret',
    });
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
    const { AppModule } = await import('../dist/app.module.js');
    const { PrismaService } = await import('../dist/prisma.service.js');
    const app = await NestFactory.create(AppModule, { logger: false });
    try {
      await app.init();
      await verifyHistory(app.getHttpServer(), app.get(PrismaService));
    } finally {
      await app.close();
    }
  } finally {
    await admin.query(`DROP DATABASE "${databaseName}"`);
  }
} finally {
  await admin.end();
}
console.log('Scan action history HTTP/PostgreSQL checks passed.');

async function verifyHistory(server, db) {
  const password = randomUUID();
  const passwordHash = await argon2.hash(password);
  async function makeTenant(tenantCode) {
    return db.tenant.create({ data: {
      tenantCode, name: 'Synthetic tenant', locationLimit: 3,
      subscription: { create: { plan: 'test', status: 'active',
        startAt: new Date(Date.now() - 86400000), endAt: new Date(Date.now() + 86400000) } },
      users: { create: [
        { role: 'tenant_manager', email: 'manager@example.invalid', passwordHash },
        { role: 'operator', username: 'scanner', passwordHash },
      ] },
    } });
  }
  async function login(tenant, identifier) {
    const agent = request.agent(server);
    await agent.post('/api/auth/login').send({ tenant_code: tenant.tenantCode, identifier, password }).expect(201);
    return agent;
  }
  const tenant = await makeTenant('10CA000181');
  const other = await makeTenant('10CA000281');
  const manager = await login(tenant, 'manager@example.invalid');
  const operator = await login(tenant, 'scanner');
  const otherManager = await login(other, 'manager@example.invalid');
  const addSite = async (agent, name) => (await agent.post('/api/locations')
    .send({ location_name: name }).expect(201)).body.location_id;
  const addPerson = async (agent, site, name) => (await agent.post(`/api/locations/${site}/people`)
    .send({ person_name: name, email: 'scan@example.invalid' }).expect(201)).body.person_code;
  const office = await addSite(manager, 'Office');
  const school = await addSite(manager, 'School');
  const foreignSite = await addSite(otherManager, 'Office');
  const person = await addPerson(manager, office, 'Scanner A');
  const neighbor = await addPerson(manager, office, 'Scanner B');
  const schoolPerson = await addPerson(manager, school, 'Scanner A');
  const foreignPerson = await addPerson(otherManager, foreignSite, 'Scanner A');
  const operatorUser = await db.user.findFirstOrThrow({ where: { tenantId: tenant.id, role: 'operator' } });
  const officeRow = await db.location.findFirstOrThrow({ where: { tenantId: tenant.id, locationCode: office } });
  const assignment = await db.operatorLocationAssignment.create({ data: {
    tenantId: tenant.id, operatorId: operatorUser.id, locationId: officeRow.id,
  } });

  const scans = '/api/scan-events';
  const scan = (agent, site, code, key = randomUUID()) => agent.post(scans)
    .set('Idempotency-Key', key).send({ location_id: site, scan_code: code });
  const detail = async (id) => (await operator.get(`${scans}/${id}`).expect(200)).body;
  const key = randomUUID();
  const first = (await scan(operator, office, 'E' + person, key).expect(201)).body;
  assert.equal(first.same_action_warning, null);
  for (const replayKey of [key, randomUUID()]) {
    const repeat = (await scan(operator, office, 'E' + person, replayKey).expect(201)).body;
    assert.equal(repeat.scan_event_id, first.scan_event_id);
    assert.equal(repeat.mail_job_id, first.mail_job_id);
    assert.equal(repeat.deduplicated, true);
    assert.equal(repeat.same_action_warning, null);
  }
  const conflict = await scan(operator, office, 'X' + person).expect(409);
  assert.equal(conflict.body.code, 'SCAN_ACTION_CONFLICT');
  assert.equal(await db.mailJob.count(), 1);
  assert.equal(await db.scanEvent.count(), 1);

  // Place the original fact on an earlier day without sleeping or changing the server clock.
  const yesterday = new Date(Date.now() - 2 * 86400000);
  async function dateFact(id, date) {
    await db.scanEvent.update({ where: { id }, data: { createdAt: date, receivedAt: date } });
  }
  await dateFact(first.scan_event_id, yesterday);
  await db.mailJob.update({ where: { id: first.mail_job_id }, data: { status: 'sent' } });
  const mapping = await db.personMapping.findUniqueOrThrow({ where: { personCode: person } });
  const unknown = await db.scanEvent.create({ data: {
    tenantId: tenant.id, locationId: officeRow.id, personMappingId: mapping.id,
    scanCode: person, scanType: 'barcode', rawPayload: '{}', receivedAt: new Date(yesterday.getTime() + 1000),
  } });
  const legacy = await detail(unknown.id);
  assert.equal(legacy.same_action_warning, null);
  assert.equal(legacy.action, 'unknown');
  assert.equal(legacy.effective_action, 'unknown');
  assert.equal(legacy.action_source, 'legacy_unknown');
  assert.equal(legacy.mail_job, null);
  const noMapping = await db.scanEvent.create({ data: {
    tenantId: tenant.id, locationId: officeRow.id, scanCode: person, personCodeSnapshot: person,
    action: 'exit', scanType: 'exit', rawPayload: '{}', receivedAt: new Date(yesterday.getTime() + 2000),
  } });
  const unlinked = await detail(noMapping.id);
  assert.equal(unlinked.same_action_warning, null);
  assert.equal(unlinked.effective_action, 'exit');
  const canceled = (await scan(operator, office, 'X' + person).expect(201)).body;
  assert.equal(canceled.same_action_warning, null);
  await operator.post(`${scans}/${canceled.scan_event_id}/cancel`).expect(200);
  const canceledDetail = await detail(canceled.scan_event_id);
  assert.equal(canceledDetail.action, 'exit');
  assert.equal(canceledDetail.mail_job.action, 'exit');
  assert.equal(canceledDetail.effective_status, 'canceled');
  assert.equal(canceledDetail.effective_action, null);
  const neighboring = (await scan(operator, office, 'X' + neighbor).expect(201)).body;
  const hidden = (await scan(manager, school, 'X' + schoolPerson).expect(201)).body;
  const foreign = (await scan(otherManager, foreignSite, 'X' + foreignPerson).expect(201)).body;
  for (const independent of [neighboring, hidden, foreign]) assert.equal(independent.same_action_warning, null);
  const secondKey = randomUUID();
  const second = (await scan(operator, office, 'E' + person, secondKey).expect(201)).body;
  const evidence = { previous_scan_event_id: first.scan_event_id, previous_received_at: yesterday.toISOString() };
  assert.deepEqual(second.same_action_warning, evidence);
  assert.equal(second.deduplicated, false);
  assert.notEqual(second.mail_job_id, first.mail_job_id);
  assert.equal(second.action, 'entry');
  const job = await db.mailJob.findUniqueOrThrow({ where: { id: second.mail_job_id } });
  assert.equal(job.actionSnapshot, 'entry');
  assert.match(job.body, /区分：入室/);
  const audit = await db.auditLog.findFirstOrThrow({ where: { tenantId: tenant.id, resourceId: second.scan_event_id, action: 'scan.created' } });
  assert.deepEqual(audit.metadataJson.same_action_warning, evidence);
  assert.deepEqual((await detail(second.scan_event_id)).same_action_warning, evidence);

  const query = { location_id: office, status: 'waiting', created_from: new Date(yesterday.getTime() + 2000).toISOString(), limit: 1 };
  const page = (await operator.get(scans).query(query).expect(200)).body;
  assert.equal(page.items[0].scan_event_id, second.scan_event_id);
  assert.deepEqual(page.items[0].same_action_warning, evidence);
  assert.equal(page.items[0].effective_action, 'entry');
  assert.ok(page.next_cursor);
  const older = (await operator.get(scans).query({ ...query, cursor: page.next_cursor }).expect(200)).body;
  assert.equal(older.items[0].scan_event_id, neighboring.scan_event_id);
  assert.equal(older.items[0].same_action_warning, null);
  assert.equal(older.items[0].effective_action, 'exit');
  for (const [agent, id] of [[operator, hidden.scan_event_id], [manager, foreign.scan_event_id], [otherManager, second.scan_event_id]]) {
    assert.equal((await agent.get(`${scans}/${id}`).expect(404)).body.code, 'SCAN_EVENT_NOT_FOUND');
  }
  await operator.get(scans).query({ location_id: school }).expect(404);
  await manager.get(scans).query({ location_id: foreignSite }).expect(404);
  await request(server).get(`${scans}/${second.scan_event_id}`).expect(401);
  await operator.post(`${scans}/${second.scan_event_id}/cancel`).expect(200);
  assert.equal((await detail(second.scan_event_id)).same_action_warning, null);
  const replay = (await scan(operator, office, 'E' + person, secondKey).expect(201)).body;
  assert.equal(replay.effective_status, 'canceled');
  assert.equal(replay.same_action_warning, null);
  const exit = (await scan(operator, office, 'X' + person).expect(201)).body;
  assert.equal(exit.same_action_warning, null);
  // Equal occurrence times use the UUID as the final ordering key.
  await dateFact(exit.scan_event_id, yesterday);
  const laterId = [first.scan_event_id, exit.scan_event_id].sort().at(-1);
  const direction = laterId === exit.scan_event_id ? 'X' : 'E';
  const tied = (await scan(operator, office, direction + person).expect(201)).body;
  assert.deepEqual(tied.same_action_warning, { previous_scan_event_id: laterId, previous_received_at: yesterday.toISOString() });
  await dateFact(neighboring.scan_event_id, yesterday);
  const consecutiveExit = (await scan(operator, office, 'X' + neighbor).expect(201)).body;
  assert.equal(consecutiveExit.same_action_warning.previous_scan_event_id, neighboring.scan_event_id);
  assert.match((await db.mailJob.findUniqueOrThrow({ where: { id: consecutiveExit.mail_job_id } })).body, /区分：退室/);
  const latest = (await operator.get(scans).query({ location_id: office, limit: 1 }).expect(200)).body;
  const next = (await operator.get(scans).query({ location_id: office, limit: 1, cursor: latest.next_cursor }).expect(200)).body;
  assert.equal(next.items[0].scan_event_id, tied.scan_event_id);
  assert.deepEqual(next.items[0].same_action_warning, tied.same_action_warning);
  const range = { location_id: office, created_from: yesterday.toISOString(), created_to: new Date().toISOString() };
  const csv = await manager.get(`${scans}/export`).query(range).expect(200);
  const [header, ...lines] = csv.text.replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(header, '"received_at","location","person_code","person_name","action","action_source","status","effective_status","canceled_at","mail_job_id","effective_action"');
  assert.ok(lines.some(line => line.endsWith(`,"${canceled.mail_job_id}",""`)));
  assert.ok(lines.some(line => line.endsWith(`,"${first.mail_job_id}","entry"`)));
  assert.ok(lines.some(line => line.endsWith(`,"${exit.mail_job_id}","exit"`)));
  assert.ok(lines.some(line => line.endsWith('"unknown","legacy_unknown","queued","active","","","unknown"')));
  assert.ok(!csv.text.includes(hidden.mail_job_id) && !csv.text.includes(foreign.mail_job_id));
  await operator.get(`${scans}/export`).query(range).expect(403);
  await db.operatorLocationAssignment.delete({ where: { id: assignment.id } });
  await operator.get(`${scans}/${second.scan_event_id}`).expect(404);
  await operator.get(scans).query({ location_id: office }).expect(404);
  await operator.get(scans).query({ ...query, cursor: page.next_cursor }).expect(404);
  assert.deepEqual((await operator.get(scans).expect(200)).body.items, []);
  await scan(operator, office, 'E' + person, secondKey).expect(404);
  assert.equal(await db.mailDeliveryAttempt.count(), 0);
}
