import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: "../.env", quiet: true });
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const sourceDatabaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://poolduck_local:poolduck_local_password@localhost:5432/poolduck_mail";
const sourceUrl = new URL(sourceDatabaseUrl);
const appEnv = process.env.APP_ENV ?? "local";
const allowedHosts = new Set(["localhost", "127.0.0.1", "postgres"]);

assert(["local", "test"].includes(appEnv), "ADR-017 validation is restricted to Local/CI.");
assert(allowedHosts.has(sourceUrl.hostname), "ADR-017 validation requires a local PostgreSQL host.");

const databaseName = `poolduck_adr017_${Date.now()}_${randomUUID().slice(0, 8)}`;
assert(/^poolduck_adr017_[a-z0-9_]+$/.test(databaseName), "Unsafe temporary database name.");

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${databaseName}`;
process.env.DATABASE_URL = testUrl.toString();
process.env.MAIL_PROVIDER = "mock";
process.env.MAIL_MOCK_SEND_RESULT = "success";
process.env.MAIL_JOB_PROCESSOR_ENABLED = "false";

const require = createRequire(import.meta.url);
const {
  PrismaService,
} = require("../dist/prisma.service.js");
const {
  AuditService,
} = require("../dist/audit/audit.service.js");
const {
  LicenseService,
} = require("../dist/license/license.service.js");
const {
  LocationAccessService,
} = require("../dist/location-access/location-access.service.js");
const {
  SandboxMailProvider,
} = require("../dist/mail-jobs/sandbox-mail.provider.js");
const {
  MailJobsService,
} = require("../dist/mail-jobs/mail-jobs.service.js");
const {
  MailJobProcessorService,
} = require("../dist/mail-jobs/mail-job-processor.service.js");
const {
  ScanEventsService,
} = require("../dist/scan-events/scan-events.service.js");
const {
  CANCEL_WAITING_MAIL_JOB_SQL,
} = require("../dist/scan-events/scan-cancellation.sql.js");
const {
  CLAIM_DUE_MAIL_JOB_SQL,
} = require("../dist/mail-jobs/mail-job-claim.sql.js");

const ids = {
  tenant: "11111111-1111-4111-8111-111111111111",
  manager: "33333333-3333-4333-8333-333333333333",
  operator: "44444444-4444-4444-8444-444444444444",
  location: "66666666-6666-4666-8666-666666666666",
  mapping: "88888888-8888-4888-8888-888888888888",
};

const manager = {
  user_id: ids.manager,
  tenant_id: ids.tenant,
  tenant_code: "10CA000001",
  email: "manager@example.local",
  username: null,
  role: "tenant_manager",
  status: "active",
};

const report = {
  database_time_boundaries: {},
  concurrent_workers: {},
  cancellation_races: {},
  restart_recovery: {},
  subscription_resource_matrix: {},
  claim_slo: {},
  guarded_rollback: {},
};

let prisma;
const admin = new Client({ connectionString: adminUrl.toString() });

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  await applyMigrations(testUrl.toString());

  prisma = new PrismaService();
  await seedSyntheticReferences(prisma);

  const audit = new AuditService(prisma);
  const license = new LicenseService(prisma);
  const locationAccess = new LocationAccessService(prisma, audit);
  const provider = new SandboxMailProvider();
  const mailJobs = new MailJobsService(
    prisma,
    license,
    provider,
    audit,
    locationAccess,
  );
  const scans = new ScanEventsService(prisma, license, audit, locationAccess);

  report.database_time_boundaries = await validateDatabaseTimeBoundaries(prisma);
  report.concurrent_workers = await validateConcurrentWorkers(prisma, mailJobs);
  report.cancellation_races = await validateCancellationRaces(
    prisma,
    scans,
    mailJobs,
  );
  report.restart_recovery = await validateRestartRecovery(prisma, mailJobs);
  report.subscription_resource_matrix = await validateLifecycleMatrix(
    prisma,
    mailJobs,
  );
  report.claim_slo = await validateClaimSlo(prisma, mailJobs);
  report.guarded_rollback = await validateGuardedRollback(
    prisma,
    testUrl.toString(),
  );

  console.log("ADR-017 release validation passed.");
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (prisma) await prisma.$disconnect();
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await admin.end();
  }
}

async function applyMigrations(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const migrationsRoot = path.join(process.cwd(), "prisma", "migrations");
    const entries = (await readdir(migrationsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const entry of entries) {
      const sql = await readFile(path.join(migrationsRoot, entry, "migration.sql"), "utf8");
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

async function seedSyntheticReferences(client) {
  await client.tenant.create({
    data: {
      id: ids.tenant,
      tenantCode: "10CA000001",
      name: "ADR017 Synthetic Tenant",
      status: "active",
      locationLimit: 2,
    },
  });
  await client.subscription.create({
    data: {
      tenantId: ids.tenant,
      plan: "mvp-local",
      status: "active",
      startAt: new Date("2026-01-01T00:00:00.000Z"),
      endAt: new Date("2099-01-01T00:00:00.000Z"),
    },
  });
  await client.user.createMany({
    data: [
      {
        id: ids.manager,
        tenantId: ids.tenant,
        email: manager.email,
        passwordHash: "synthetic-not-login-capable",
        role: "tenant_manager",
        status: "active",
      },
      {
        id: ids.operator,
        tenantId: ids.tenant,
        username: "adr017-operator",
        email: "operator@example.local",
        passwordHash: "synthetic-not-login-capable",
        role: "operator",
        status: "active",
      },
    ],
  });
  await client.location.create({
    data: {
      id: ids.location,
      tenantId: ids.tenant,
      locationCode: "10CA1001",
      name: "ADR017 Synthetic Location",
      status: "active",
    },
  });
  await client.personMapping.create({
    data: {
      id: ids.mapping,
      tenantId: ids.tenant,
      locationId: ids.location,
      personCode: "01K0ABC10001",
      scanCode: "01K0ABC10001",
      personName: "ADR017 Synthetic Person",
      email: "recipient@example.local",
      status: "active",
    },
  });
  await client.operatorLocationAssignment.create({
    data: {
      tenantId: ids.tenant,
      operatorId: ids.operator,
      locationId: ids.location,
    },
  });
}

async function createJob(client, deadlineDeltaMs, suffix = "boundary") {
  const scanEventId = randomUUID();
  const mailJobId = randomUUID();
  await client.$executeRawUnsafe(
    `INSERT INTO "scan_events" (
       "id", "tenant_id", "location_id", "person_mapping_id",
       "person_code_snapshot", "scan_code", "scan_type", "action",
       "action_source", "raw_payload", "received_at", "created_by_user_id"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid,
       '01K0ABC10001', '01K0ABC10001', 'entry', 'entry',
       'person_action_code', '{"source":"synthetic-validation"}', CURRENT_TIMESTAMP, $5::uuid
     )`,
    scanEventId,
    ids.tenant,
    ids.location,
    ids.mapping,
    ids.manager,
  );
  await client.$executeRawUnsafe(
    `INSERT INTO "mail_jobs" (
       "id", "tenant_id", "location_id", "person_mapping_id", "scan_event_id",
       "tenant_name_snapshot", "location_name_snapshot", "person_name_snapshot",
       "person_code_snapshot", "action_snapshot", "context_snapshot_source",
       "to_email", "subject", "body", "template_key", "status",
       "cancel_until", "send_not_before", "created_at", "updated_at"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
       'ADR017 Synthetic Tenant', 'ADR017 Synthetic Location', 'ADR017 Synthetic Person',
       '01K0ABC10001', 'entry', 'scan_relation',
       'recipient@example.local', $6, 'synthetic body', 'scan_entry_notice_v1', 'waiting',
       date_trunc('milliseconds', CURRENT_TIMESTAMP) + ($7::double precision * INTERVAL '1 millisecond'),
       date_trunc('milliseconds', CURRENT_TIMESTAMP) + ($7::double precision * INTERVAL '1 millisecond'),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )`,
    mailJobId,
    ids.tenant,
    ids.location,
    ids.mapping,
    scanEventId,
    `ADR017 ${suffix}`,
    deadlineDeltaMs,
  );
  return { scanEventId, mailJobId };
}

async function validateDatabaseTimeBoundaries(client) {
  const cases = [
    { name: "before_1ms", delta: 1, cancel: 1, claim: 0 },
    { name: "exact_deadline", delta: 0, cancel: 0, claim: 1 },
    { name: "after_1ms", delta: -1, cancel: 0, claim: 1 },
  ];
  const results = {};
  for (const boundary of cases) {
    const rollback = new Error("ROLLBACK_BOUNDARY");
    try {
      await client.$transaction(async (tx) => {
        const job = await createJob(tx, boundary.delta, boundary.name);
        const canceled = await tx.$executeRawUnsafe(
          CANCEL_WAITING_MAIL_JOB_SQL,
          job.mailJobId,
          ids.tenant,
          ids.location,
          job.scanEventId,
        );
        const claimed = await tx.$executeRawUnsafe(
          CLAIM_DUE_MAIL_JOB_SQL,
          randomUUID(),
          job.mailJobId,
          ids.tenant,
          true,
        );
        assert(canceled === boundary.cancel, `${boundary.name}: unexpected cancellation result.`);
        assert(claimed === boundary.claim, `${boundary.name}: unexpected claim result.`);
        results[boundary.name] = { canceled, claimed };
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }
  return results;
}

async function validateConcurrentWorkers(client, mailJobs) {
  const job = await client.$transaction((tx) => createJob(tx, -1_000, "workers"));
  const outcomes = await Promise.allSettled([
    mailJobs.processQueuedMailJob(ids.tenant, job.mailJobId, null),
    mailJobs.processQueuedMailJob(ids.tenant, job.mailJobId, null),
    mailJobs.processQueuedMailJob(ids.tenant, job.mailJobId, null),
  ]);
  const attempts = await client.mailDeliveryAttempt.findMany({
    where: { mailJobId: job.mailJobId },
  });
  const current = await client.mailJob.findUniqueOrThrow({ where: { id: job.mailJobId } });
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
  assert(fulfilled === 1, "Only one worker may win an atomic claim.");
  assert(current.status === "sent", "The winning worker did not reach sent.");
  assert(attempts.length === 1, "Concurrent workers created duplicate delivery attempts.");
  assert(attempts[0].providerInvokedAt, "The winning attempt did not record provider invocation.");
  return { workers: 3, winning_claims: fulfilled, attempts: attempts.length };
}

async function validateCancellationRaces(client, scans, mailJobs) {
  const future = await client.$transaction((tx) => createJob(tx, 10_000, "cancel-wins"));
  const cancelResult = await scans.cancelScanEvent(manager, future.scanEventId);
  await expectRejected(
    () => mailJobs.processQueuedMailJob(ids.tenant, future.mailJobId, null),
    "A worker unexpectedly claimed a canceled job.",
  );
  const canceledAttempts = await client.mailDeliveryAttempt.count({
    where: { mailJobId: future.mailJobId },
  });
  assert(cancelResult.mail_status === "canceled", "Cancellation did not win before the deadline.");
  assert(canceledAttempts === 0, "A successfully canceled job has a provider attempt.");

  const due = await client.$transaction((tx) => createJob(tx, -1_000, "worker-wins"));
  const outcomes = await Promise.allSettled([
    scans.cancelScanEvent(manager, due.scanEventId),
    mailJobs.processQueuedMailJob(ids.tenant, due.mailJobId, null),
  ]);
  const dueJob = await client.mailJob.findUniqueOrThrow({ where: { id: due.mailJobId } });
  const dueAttempts = await client.mailDeliveryAttempt.count({ where: { mailJobId: due.mailJobId } });
  assert(dueJob.status === "sent", "The due worker did not win at/after the deadline.");
  assert(dueAttempts === 1, "The worker-winning race did not have exactly one attempt.");
  assert(outcomes.filter((outcome) => outcome.status === "fulfilled").length === 1, "Both race paths succeeded.");
  return {
    cancellation_wins_attempts: canceledAttempts,
    worker_wins_attempts: dueAttempts,
    unique_terminal_state: true,
  };
}

async function validateRestartRecovery(client, mailJobs) {
  const beforeProvider = await client.$transaction((tx) => createJob(tx, -1_000, "stale-before-provider"));
  const beforeAttempt = randomUUID();
  await markStaleProcessing(client, beforeProvider.mailJobId, beforeAttempt, false);
  await mailJobs.recoverStaleProcessingJobs(new Date());
  const requeued = await client.mailJob.findUniqueOrThrow({ where: { id: beforeProvider.mailJobId } });
  assert(requeued.status === "waiting", "Pre-provider stale claim was not made sendable again.");
  await mailJobs.processQueuedMailJob(ids.tenant, beforeProvider.mailJobId, null);
  assert(
    (await client.mailDeliveryAttempt.count({ where: { mailJobId: beforeProvider.mailJobId } })) === 2,
    "Recovered job did not preserve the abandoned attempt plus one new attempt.",
  );

  const afterProvider = await client.$transaction((tx) => createJob(tx, -1_000, "stale-after-provider"));
  const afterAttempt = randomUUID();
  await markStaleProcessing(client, afterProvider.mailJobId, afterAttempt, true);
  await mailJobs.recoverStaleProcessingJobs(new Date());
  const unknown = await client.mailJob.findUniqueOrThrow({ where: { id: afterProvider.mailJobId } });
  assert(unknown.status === "delivery_unknown", "Invoked stale claim did not enter delivery_unknown.");
  await expectRejected(
    () => mailJobs.processQueuedMailJob(ids.tenant, afterProvider.mailJobId, null),
    "delivery_unknown was automatically resent.",
  );
  assert(
    (await client.mailDeliveryAttempt.count({ where: { mailJobId: afterProvider.mailJobId } })) === 1,
    "delivery_unknown created another attempt.",
  );
  return { stale_before_provider: "recovered_once", stale_after_provider: "delivery_unknown" };
}

async function markStaleProcessing(client, mailJobId, attemptId, invoked) {
  await client.mailDeliveryAttempt.create({
    data: {
      id: attemptId,
      tenantId: ids.tenant,
      mailJobId,
      status: invoked ? "invoked" : "claimed",
      claimedAt: new Date("2026-01-01T00:00:00.000Z"),
      providerInvokedAt: invoked ? new Date("2026-01-01T00:00:01.000Z") : null,
    },
  });
  await client.mailJob.update({
    where: { id: mailJobId },
    data: {
      status: "processing",
      claimedAt: new Date("2026-01-01T00:00:00.000Z"),
      claimAttemptId: attemptId,
    },
  });
}

async function validateLifecycleMatrix(client, mailJobs) {
  const subscriptionResults = {};
  for (const status of ["trial", "active", "expired", "suspended"]) {
    await client.subscription.update({ where: { tenantId: ids.tenant }, data: { status } });
    const job = await client.$transaction((tx) => createJob(tx, -1_000, `subscription-${status}`));
    const result = await mailJobs.processQueuedMailJob(ids.tenant, job.mailJobId, null);
    const attempts = await client.mailDeliveryAttempt.findMany({ where: { mailJobId: job.mailJobId } });
    const sendable = status === "trial" || status === "active";
    assert(result.status === (sendable ? "sent" : "failed"), `${status}: unexpected terminal status.`);
    assert(
      attempts.filter((attempt) => attempt.providerInvokedAt).length === (sendable ? 1 : 0),
      `${status}: provider invocation violated subscription gate.`,
    );
    subscriptionResults[status] = result.status;
  }
  await client.subscription.update({ where: { tenantId: ids.tenant }, data: { status: "active" } });

  const resourceResults = {};
  for (const resource of [
    { field: "person", status: "inactive" },
    { field: "person", status: "pending_delete" },
    { field: "location", status: "inactive" },
    { field: "location", status: "pending_delete" },
    { field: "location", status: "purged" },
  ]) {
    const model = resource.field === "person" ? client.personMapping : client.location;
    const where = { id: resource.field === "person" ? ids.mapping : ids.location };
    await model.update({ where, data: { status: resource.status } });
    const job = await client.$transaction((tx) => createJob(tx, -1_000, `${resource.field}-${resource.status}`));
    const result = await mailJobs.processQueuedMailJob(ids.tenant, job.mailJobId, null);
    const invoked = await client.mailDeliveryAttempt.count({
      where: { mailJobId: job.mailJobId, providerInvokedAt: { not: null } },
    });
    assert(result.status === "failed" && invoked === 0, `${resource.field}/${resource.status} was not fail-closed.`);
    resourceResults[`${resource.field}_${resource.status}`] = result.status;
    await model.update({ where, data: { status: "active" } });
  }
  const recovered = await client.$transaction((tx) => createJob(tx, -1_000, "resource-recovered"));
  const recoveredResult = await mailJobs.processQueuedMailJob(ids.tenant, recovered.mailJobId, null);
  assert(recoveredResult.status === "sent", "Recovered active resources were not sendable.");
  resourceResults.recovered = recoveredResult.status;
  return { subscriptions: subscriptionResults, resources: resourceResults };
}

async function validateClaimSlo(client, mailJobs) {
  const capacity = 40;
  const jobs = [];
  await client.$transaction(async (tx) => {
    for (let index = 0; index < capacity; index += 1) {
      jobs.push(await createJob(tx, 500, `slo-${index}`));
    }
  });
  const processors = [
    new MailJobProcessorService(client, mailJobs),
    new MailJobProcessorService(client, mailJobs),
  ];
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    await Promise.all(processors.map((processor) => processor.processDueJobs()));
    const sent = await client.mailJob.count({
      where: { id: { in: jobs.map((job) => job.mailJobId) }, status: "sent" },
    });
    if (sent === capacity) break;
    await sleep(250);
  }
  const rows = await client.$queryRawUnsafe(
    `SELECT EXTRACT(EPOCH FROM ("claimed_at" - "send_not_before")) * 1000 AS "latencyMs"
     FROM "mail_jobs" WHERE "id" = ANY($1::uuid[]) ORDER BY 1`,
    jobs.map((job) => job.mailJobId),
  );
  assert(rows.length === capacity, "SLO batch did not finish within the validation deadline.");
  const latencies = rows.map((row) => Number(row.latencyMs));
  assert(latencies.every((value) => value >= 0), "A provider claim occurred before send_not_before.");
  const p95 = percentile(latencies, 0.95);
  const p99 = percentile(latencies, 0.99);
  assert(p95 <= 2_000, `Synthetic claim p95 ${p95}ms exceeded 2000ms.`);
  assert(p99 <= 5_000, `Synthetic claim p99 ${p99}ms exceeded 5000ms.`);
  return {
    jobs: capacity,
    workers: processors.length,
    p95_ms: Math.round(p95),
    p99_ms: Math.round(p99),
    early_claims: 0,
  };
}

async function validateGuardedRollback(client, connectionString) {
  const waiting = await client.$transaction((tx) => createJob(tx, 60_000, "rollback-guard"));
  const rollbackSql = await readFile(
    path.join(process.cwd(), "prisma", "rollback", "20260806010000_add_scan_send_cancellation.sql"),
    "utf8",
  );
  const pg = new Client({ connectionString });
  await pg.connect();
  let blocked = false;
  try {
    await pg.query("BEGIN");
    try {
      await pg.query(rollbackSql);
    } catch (error) {
      blocked = String(error?.message ?? error).includes(
        "rollback blocked: waiting mail jobs must be processed or canceled first",
      );
    } finally {
      await pg.query("ROLLBACK");
    }
    assert(blocked, "Guarded rollback did not reject a waiting mail job.");

    await client.mailJob.update({ where: { id: waiting.mailJobId }, data: { status: "canceled" } });
    await pg.query("BEGIN");
    await pg.query(rollbackSql);
    const defaults = await pg.query(
      `SELECT column_name, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'mail_jobs'
         AND column_name IN ('status', 'cancel_until', 'send_not_before')`,
    );
    assert(defaults.rows.length === 3, "Rollback rehearsal lost ADR-017 evidence columns.");
    assert(
      defaults.rows.find((row) => row.column_name === "status")?.column_default?.includes("queued"),
      "Rollback did not restore the queued default.",
    );
    assert(
      defaults.rows.filter((row) => row.column_name !== "status").every((row) => row.column_default === null),
      "Rollback did not remove only the deadline defaults.",
    );
    await pg.query("ROLLBACK");
  } finally {
    await pg.end();
  }
  return { waiting_guard: "blocked", terminal_rehearsal: "passed", evidence_columns_retained: 3 };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function expectRejected(operation, message) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
