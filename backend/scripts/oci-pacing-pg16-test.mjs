import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PrismaService } from '../dist/prisma.service.js';
import { AuditService } from '../dist/audit/audit.service.js';
import { LicenseService } from '../dist/license/license.service.js';
import { LocationAccessService } from '../dist/location-access/location-access.service.js';
import { MailJobsService } from '../dist/mail-jobs/mail-jobs.service.js';
import { OciMailRateLimiter } from '../dist/mail-jobs/oci-mail-rate-limiter.js';

assert(['local', 'test'].includes(process.env.APP_ENV), 'Local/test only');
const url = new URL(process.env.DATABASE_URL);
assert(['postgresql:', 'postgres:'].includes(url.protocol));
assert(['127.0.0.1', 'localhost'].includes(url.hostname) && !url.search, 'Use a local PostgreSQL URL without query parameters');
process.env.MAIL_PROVIDER = 'mock';
process.env.REAL_MAIL_SEND_ENABLED = 'false';
url.pathname = '/postgres';
const admin = new Client({ connectionString: url.href });
const database = 'poolduck_pacing_' + randomUUID().replaceAll('-', '');
const calls = new Map();
const fake = {
  async send({ mailJobId, attemptId }) {
    const attempts = calls.get(mailJobId) ?? [];
    attempts.push(attemptId);
    calls.set(mailJobId, attempts);
    return {
      provider: 'oci_email_delivery_https', success: true, disposition: 'accepted',
      providerMessageId: attemptId, envelopeId: attemptId, opcRequestId: attemptId,
    };
  },
};

function worker(db) {
  const audit = new AuditService(db);
  return new MailJobsService(db, new LicenseService(db), fake, audit,
    new LocationAccessService(db, audit), { kind: 'oci_email_delivery_https', messageIdDomain: 'example.invalid' },
    new OciMailRateLimiter(db));
}

async function fixture(db, suffix) {
  const tenant = await db.tenant.create({ data: {
    tenantCode: '10CA00000' + suffix, name: 'Synthetic tenant', locationLimit: 1,
    subscription: { create: { plan: 'test', status: 'active', startAt: new Date(0), endAt: new Date('2099-01-01') } },
  } });
  const location = await db.location.create({ data: {
    tenantId: tenant.id, locationCode: '10CA100' + suffix, name: 'Synthetic location',
  } });
  const person = await db.personMapping.create({ data: {
    tenantId: tenant.id, locationId: location.id, personCode: '01K0ABC1000' + suffix,
    scanCode: '01K0ABC1000' + suffix, personName: 'Synthetic person', email: 'fixture@example.invalid',
  } });
  return { tenant, location, person };
}

async function dueJob(db, { tenant, location, person }) {
  const keys = { tenantId: tenant.id, locationId: location.id, personMappingId: person.id };
  const [{ receivedAt }] = await db.$queryRaw`SELECT CURRENT_TIMESTAMP - INTERVAL '1 minute' AS "receivedAt"`;
  const deadline = new Date(receivedAt.getTime() + 10_000);
  const scan = await db.scanEvent.create({ data: {
    ...keys, scanCode: person.scanCode, scanType: 'entry', action: 'entry',
    actionSource: 'person_action_code', rawPayload: 'synthetic', receivedAt, createdAt: receivedAt,
  } });
  // Model an already-due retry. Nonzero lets us detect both increment and reset on deferral.
  return db.mailJob.create({ data: {
    ...keys, scanEventId: scan.id, tenantNameSnapshot: tenant.name, locationNameSnapshot: location.name,
    personNameSnapshot: person.personName, personCodeSnapshot: person.personCode, actionSnapshot: 'entry',
    toEmail: person.email, subject: 'Synthetic', body: 'Synthetic', templateKey: 'synthetic',
    status: 'queued', retryCount: 1, scheduledAt: new Date(deadline.getTime() + 30_000),
    createdAt: receivedAt, cancelUntil: deadline, sendNotBefore: deadline,
  } });
}

function processJob(service, job) {
  return service.processQueuedMailJob(job.tenantId, job.id, null);
}

const readJob = (db, id) => db.mailJob.findUniqueOrThrow({ where: { id }, include: { deliveryAttempts: true } });

function acceptedAttempt(job) {
  assert.equal(job.status, 'sent');
  assert.equal(job.retryCount, 1);
  assert.equal(job.scheduledAt, null);
  const invoked = job.deliveryAttempts.filter(attempt => attempt.providerInvokedAt);
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0].status, 'succeeded');
  assert.equal(invoked[0].tenantId, job.tenantId);
  assert.ok(invoked[0].rfcMessageId);
  assert.deepEqual(calls.get(job.id), [invoked[0].id]);
  return invoked[0];
}

async function checkDeferred(db, response, prior) {
  const job = await readJob(db, response.mail_job_id);
  if (job.status === 'sent') {
    const actual = acceptedAttempt(job);
    const gap = Math.abs(actual.providerInvokedAt - prior.providerInvokedAt);
    assert.ok(gap >= 50, `Two reservations were admitted only ${gap} ms apart`);
    throw new Error(`Inconclusive: the workers reached the database ${gap} ms apart; the 50 ms deferral window was not sampled`);
  }
  assert.equal(job.status, 'queued');
  assert.equal(response.status, 'queued');
  assert.equal(job.retryCount, 1);
  assert.equal(response.retry_count, job.retryCount);
  assert.equal(job.errorMessage, 'PROVIDER_RATE_LIMITED');
  assert.equal(response.provider_result.error_message, job.errorMessage);
  assert.equal(job.claimedAt, null);
  assert.equal(job.claimAttemptId, null);
  assert.equal(job.scheduledAt.getTime(), prior.providerInvokedAt.getTime() + 50);
  assert.equal(response.scheduled_at, job.scheduledAt.toISOString());
  assert.equal(job.deliveryAttempts.length, 1);
  const [attempt] = job.deliveryAttempts;
  assert.equal(attempt.tenantId, job.tenantId);
  assert.equal(attempt.status, 'deferred');
  assert.equal(attempt.errorCode, job.errorMessage);
  assert.ok(attempt.completedAt && attempt.completedAt < job.scheduledAt);
  assert.equal(attempt.providerInvokedAt, null);
  assert.equal(attempt.rfcMessageId, null);
  assert.equal(attempt.providerMessageId, null);
  assert.deepEqual(calls.get(job.id) ?? [], []);
  assert.equal(await db.auditLog.count({ where: {
    tenantId: job.tenantId, resourceId: job.id, action: 'mail.rate.deferred',
  } }), 1);
  return job;
}

async function exercise() {
  const first = new PrismaService();
  const second = new PrismaService();
  const reopened = new PrismaService();
  try {
    const pid = async db => (await db.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid;
    const oldPids = await Promise.all([pid(first), pid(second)]);
    assert.notEqual(oldPids[0], oldPids[1]);
    const refs = await Promise.all([fixture(first, '1'), fixture(second, '2')]);
    const jobs = await Promise.all(refs.map(ref => dueJob(first, ref)));
    const workers = [worker(first), worker(second)];
    const results = await Promise.all(jobs.map((job, i) => processJob(workers[i], job)));
    const winner = results.findIndex(result => result.status === 'sent');
    assert.notEqual(winner, -1);
    const winningJob = await readJob(first, jobs[winner].id);
    assert.equal(winningJob.deliveryAttempts.length, 1);
    const admitted = acceptedAttempt(winningJob);
    const deferred = await checkDeferred(second, results[1 - winner], admitted);
    assert.equal(calls.size, 1);
    console.log('Two workers: 1 succeeded, 1 deferred; scheduledAt = reservation + 50 ms; retryCount = 1; fake calls 1 / 0.');

    const next = await dueJob(first, refs[winner]);
    await Promise.all([first.$disconnect(), second.$disconnect()]);
    const newPid = await pid(reopened);
    assert.ok(!oldPids.includes(newPid));
    const writer = worker(reopened);
    // PostgreSQL decides when the persisted job is due, including after a cold reconnect.
    await reopened.$queryRaw`SELECT 1::int FROM pg_sleep(GREATEST(0,
      EXTRACT(EPOCH FROM (${deferred.scheduledAt}::timestamp - clock_timestamp() AT TIME ZONE 'UTC'))))`;
    // Warm only the independent connection. The next service and limiter are constructed
    // after the previous worker has committed its reservation and disconnected.
    const readerPid = await pid(second);
    assert.ok(![...oldPids, newPid].includes(readerPid));
    const retried = await processJob(writer, deferred);
    await reopened.$disconnect();
    const afterRestart = await processJob(worker(second), next);
    assert.equal(retried.status, 'sent');
    const resumed = await readJob(second, deferred.id);
    const latest = acceptedAttempt(resumed);
    assert.ok(latest.providerInvokedAt >= deferred.scheduledAt);
    assert.equal(resumed.deliveryAttempts.length, 2);
    const oldAttempt = resumed.deliveryAttempts.find(a => a.id === deferred.deliveryAttempts[0].id);
    assert.deepEqual(oldAttempt, deferred.deliveryAttempts[0]);
    await checkDeferred(second, afterRestart, latest);
    assert.equal(calls.size, 2);
    console.log('Reconnected: 1 preserved deferred row, 1 due re-claim succeeded; newly initialized service deferred the third job; total fake calls 2.');
  } finally {
    await Promise.all([first.$disconnect(), second.$disconnect(), reopened.$disconnect()]);
  }
}

await admin.connect();
try {
  const { rows: [version] } = await admin.query("SELECT current_setting('server_version') AS version, current_setting('server_version_num')::int AS number");
  assert.equal(Math.floor(version.number / 10000), 16, 'Requires PG16');
  await admin.query(`CREATE DATABASE "${database}"`);
  try {
    url.pathname = '/' + database;
    process.env.DATABASE_URL = url.href;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
    await exercise();
    console.log('PASS PostgreSQL', version.version);
  } finally {
    await admin.query(`DROP DATABASE "${database}"`);
  }
} finally {
  await admin.end();
}
