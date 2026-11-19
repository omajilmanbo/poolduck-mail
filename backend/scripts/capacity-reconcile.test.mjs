import assert from "node:assert/strict";
import test from "node:test";
import { main } from "./capacity-load-test.mjs";
import {
  captureScan,
  readReconciliationEvidence,
  reconciliationDatabaseUrl,
  reconcileScans,
} from "./capacity-reconcile.mjs";

const local = {
  APP_ENV: "local", MAIL_PROVIDER: "mock", REAL_MAIL_SEND_ENABLED: "false",
  DATABASE_URL: "postgresql://postgres/capacity152",
};
const loopback = { baseUrl: "http://127.0.0.1:3001", steps: [1] };
const uuid = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;

function sample(number, location = "north", tenant = "a") {
  const event = { eventId: uuid(number), tenant, location, locationMatchesTenant: true, newDuringRun: true };
  const job = { ...event, jobId: uuid(number + 100), recipientMatches: true };
  const key = uuid(number + 200);
  const request = captureScan({
    key, tenant, location, kind: "valid", expected: true,
    result: {
      status: 201,
      body: { scan_event_id: event.eventId, mail_job_id: job.jobId, deduplicated: false },
    },
  });
  const stored = { keyHash: request.keyHash, tenant, eventId: event.eventId, jobId: job.jobId };
  return { event, job, request, stored };
}

const north = sample(1);
const south = sample(2, "south");
const clean = {
  keys: [north.stored, south.stored], events: [north.event, south.event], jobs: [north.job, south.job],
};
const empty = { keys: [], events: [], jobs: [] };

test("reconciliation permits one Local mock stage and rejects nonlocal or ambiguous endpoints", () => {
  assert.equal(reconciliationDatabaseUrl(local, loopback), local.DATABASE_URL);
  for (const environment of [
    { APP_ENV: "staging" }, { REAL_MAIL_SEND_ENABLED: "true" }, { MAIL_PROVIDER: "sandbox" },
    { DATABASE_URL: "postgresql://external.example/capacity152" },
    { DATABASE_URL: "postgresql://postgres/other" },
    { DATABASE_URL: "postgresql://postgres/capacity152?host=external.example" },
  ]) {
    assert.throws(() => reconciliationDatabaseUrl({ ...local, ...environment }, loopback), /requires/);
  }
  for (const parameters of [
    { baseUrl: "https://app.poolducktest.com" },
    { baseUrl: "http://localhost/api" },
    { baseUrl: "http://fixture@localhost" },
    { steps: [1, 5] },
  ]) {
    assert.throws(() => reconciliationDatabaseUrl(local, { ...loopback, ...parameters }), /requires/);
  }
});

test("reconciliation plan uses allowlisted output while the legacy plan keeps its existing fields", async (context) => {
  const log = context.mock.method(console, "log", () => {});
  const env = {
    ...local, CAPACITY_PLAN_ONLY: "true", CAPACITY_STEPS: "1",
    CAPACITY_UNMAPPED_SCAN_CODE: "fixture-private-action", CAPACITY_TENANT_CODE: "fixture-private-tenant",
  };
  await main(env, true);
  await main(env, false);
  const [reconciled, legacy] = log.mock.calls.map(({ arguments: [line] }) => JSON.parse(line).config);
  assert.equal(reconciled.reconcile, true);
  assert.equal(reconciled.planOnly, true);
  assert.equal(Object.hasOwn(reconciled, "unmappedScanCode"), false);
  assert.equal(Object.hasOwn(reconciled, "tenantCode"), false);
  assert.equal(Object.hasOwn(reconciled, "databaseUrl"), false);
  assert.equal(legacy.unmappedScanCode, env.CAPACITY_UNMAPPED_SCAN_CODE);
  assert.equal(legacy.tenantCode, env.CAPACITY_TENANT_CODE);
});

test("collection keeps validated response links but drops the raw key and private data", () => {
  const input = {
    key: "fixture-raw-key", tenant: "a", location: "north", kind: "valid", expected: true,
    result: {
      status: 201, cookie: "fixture-cookie",
      body: {
        scan_event_id: north.event.eventId, mail_job_id: north.job.jobId, deduplicated: false,
        to_email: "fixture@example.invalid", scan_code: "fixture-action", mail_subject: "fixture-subject",
      },
    },
  };
  const captured = captureScan(input);
  assert.match(captured.keyHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(captured.response, north.request.response);
  for (const value of [input.key, input.result.cookie, ...Object.values(input.result.body).slice(3)]) {
    assert.ok(!JSON.stringify(captured).includes(value));
  }
  assert.equal(captureScan({ ...input, result: { status: 201, body: { deduplicated: false } } }).response, null);
});

test("two new scans and an expected rejection pass without emitting any row identifiers", () => {
  const denied = { ...sample(3).request, kind: "unmapped", status: 404, response: null };
  const result = reconcileScans([north.request, south.request, denied], clean);
  assert.equal(result.status, "passed");
  assert.equal(result.matched_responses, 2);
  assert.equal(result.expected_rejections, 1);
  assert.equal(result.unlinked_new_jobs, 0);
  assert.ok(!JSON.stringify(result).includes(north.request.keyHash));
  assert.ok(!JSON.stringify(result).includes(north.job.jobId));
});

test("same-key replay and a new key with a deduplicated response reuse one original job", () => {
  const existing = { ...north.request, response: { ...north.request.response, deduplicated: true } };
  const withNewKey = { ...existing, keyHash: south.request.keyHash };
  const snapshot = {
    keys: [north.stored, { ...north.stored, keyHash: withNewKey.keyHash }],
    events: [north.event], jobs: [north.job],
  };
  const result = reconcileScans([north.request, existing, withNewKey], snapshot);
  assert.equal(result.status, "passed");
  assert.equal(result.matched_responses, 1);
  assert.equal(result.matched_replays, 2);
  assert.equal(result.duplicate_creations, 0);
  assert.equal(reconcileScans([north.request, { ...north.request, keyHash: withNewKey.keyHash }], snapshot).duplicate_creations, 1);
});

test("a prior-stage replay can pass, but a creation response may not point to a prior-stage job", () => {
  const snapshot = {
    keys: [north.stored],
    events: [{ ...north.event, newDuringRun: false }],
    jobs: [{ ...north.job, newDuringRun: false }],
  };
  assert.equal(reconcileScans([north.request], snapshot).creations_outside_run, 1);
  const replay = { ...north.request, response: { ...north.request.response, deduplicated: true } };
  assert.equal(reconcileScans([replay], snapshot).status, "passed");
});

test("transport loss and 5xx can be linked by the key, while absent evidence stays incomplete", () => {
  const requests = [
    { ...north.request, status: 0, expected: false, response: null },
    { ...south.request, status: 500, expected: false, response: null },
  ];
  const result = reconcileScans(requests, clean);
  assert.equal(result.status, "passed");
  assert.equal(result.matched_without_response, 2);
  assert.equal(reconcileScans(requests, empty).status, "incomplete");
  assert.equal(reconcileScans(requests, empty).missing_evidence, 2);
  assert.equal(reconcileScans([{ ...north.request, response: null }, south.request], clean).status, "incomplete");
  assert.equal(reconcileScans([], empty).status, "incomplete");
});

test("equal totals can conceal a missing job and a duplicate job", () => {
  const snapshot = { ...clean, jobs: [north.job, { ...north.job, jobId: uuid(999) }] };
  const result = reconcileScans([north.request, south.request], snapshot);
  assert.equal(result.status, "failed");
  assert.equal(result.missing_jobs, 1);
  assert.equal(result.duplicate_jobs, 1);
  assert.equal(result.unlinked_new_jobs, 1);
});

test("reports swapped locations, a different tenant and a wrong recipient without exposing values", () => {
  const result = reconcileScans([north.request, south.request], {
    ...clean,
    keys: [north.stored, { ...south.stored, tenant: "foreign-tenant-fixture" }],
    events: [north.event, { ...south.event, locationMatchesTenant: false }],
    jobs: [
      { ...north.job, location: "south" },
      { ...south.job, location: "north", recipientMatches: false },
    ],
  });
  assert.equal(result.status, "failed");
  assert.equal(result.context_mismatches, 2);
  assert.equal(result.recipient_mismatches, 1);
  assert.equal(result.matched_responses, 0);
  assert.ok(!JSON.stringify(result).includes("foreign-tenant-fixture"));
});

test("rejects the wrong event-job link, unexpected persistence, and unattached new records", () => {
  const wrongJob = { ...north.request, response: { ...north.request.response, jobId: south.job.jobId } };
  assert.equal(reconcileScans([wrongJob, south.request], clean).wrong_links, 1);
  const denied = { ...north.request, kind: "suspended", status: 403, response: null };
  assert.equal(reconcileScans([denied, south.request], clean).unexpected_persistence, 1);
  assert.equal(reconcileScans([south.request], clean).unlinked_new_events, 1);
});

test("database adapter uses a single read-only snapshot and fetches both receipt and key-linked IDs", async () => {
  const calls = [];
  const database = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      const rows = { 2: clean.keys, 3: clean.events, 4: clean.jobs }[calls.length] ?? [];
      return { rows };
    },
  };
  const noReceipt = { ...south.request, response: null, status: 0 };
  const runStartedAt = "2026-11-19 01:00:00";
  assert.deepEqual(await readReconciliationEvidence(database, [north.request, noReceipt], runStartedAt), clean);
  assert.equal(calls[0].sql, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.deepEqual(calls[1].parameters, ["POST:/api/scan-events", [north.request.keyHash, south.request.keyHash]]);
  assert.deepEqual(calls[2].parameters, [[north.event.eventId, south.event.eventId], runStartedAt]);
  assert.deepEqual(calls[3].parameters, [
    [north.event.eventId, south.event.eventId], [north.job.jobId, south.job.jobId], runStartedAt,
  ]);
  assert.match(calls[3].sql, /p\.email = j\.to_email/);
  assert.equal(calls[4].sql, "COMMIT");
});

test("database evidence failure rolls back instead of returning partial evidence", async () => {
  const calls = [];
  const database = {
    query: async (sql) => {
      calls.push(sql);
      if (calls.length === 2) throw new Error("synthetic database read failed");
      return { rows: [] };
    },
  };
  await assert.rejects(readReconciliationEvidence(database, [north.request], "fixture"), /synthetic/);
  assert.equal(calls.at(-1), "ROLLBACK");
  assert.equal(calls.length, 3);
});
