import { createHash } from "node:crypto";

const SCAN_ROUTE = "POST:/api/scan-events";
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export function reconciliationDatabaseUrl(env, config) {
  if (env.APP_ENV !== "local" || env.MAIL_PROVIDER !== "mock" ||
      env.REAL_MAIL_SEND_ENABLED !== "false") {
    throw new Error("Capacity reconciliation requires Local mock mode with real mail disabled.");
  }
  const api = new URL(config.baseUrl);
  if (!LOOPBACK.has(api.hostname) || api.protocol !== "http:" || api.pathname !== "/" ||
      api.username || api.password || api.search || api.hash || config.steps.length !== 1) {
    throw new Error("Capacity reconciliation requires a loopback HTTP origin and exactly one step.");
  }
  const database = URL.canParse(env.DATABASE_URL ?? "") ? new URL(env.DATABASE_URL) : null;
  if (!database || !["postgresql:", "postgres:"].includes(database.protocol) ||
      (!LOOPBACK.has(database.hostname) && database.hostname !== "postgres") ||
      database.pathname !== "/capacity152" || database.search || database.hash) {
    throw new Error("Capacity reconciliation requires the dedicated local capacity152 PostgreSQL database.");
  }
  return database.href;
}

export function captureScan({ key, tenant, location, kind, expected, result }) {
  const { scan_event_id: eventId, mail_job_id: jobId, deduplicated } = result.body ?? {};
  const validLink = result.status === 201 && typeof deduplicated === "boolean" &&
    typeof eventId === "string" && UUID.test(eventId) && typeof jobId === "string" && UUID.test(jobId);
  return {
    keyHash: createHash("sha256").update(key).digest("hex"),
    tenant,
    location,
    kind,
    status: result.status,
    expected,
    response: validLink ? { eventId, jobId, deduplicated } : null,
  };
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
}

export function reconcileScans(requests, { keys, events, jobs }) {
  const keysByHash = groupBy(keys, "keyHash");
  const eventsById = new Map(events.map((event) => [event.eventId, event]));
  const jobsById = new Map(jobs.map((job) => [job.jobId, job]));
  const jobsByEvent = groupBy(jobs, "eventId");
  const newResponses = new Set();
  const linkedEvents = new Set();
  const linkedJobs = new Set();
  const observations = {
    matched_responses: 0,
    matched_replays: 0,
    matched_without_response: 0,
    expected_rejections: 0,
    missing_evidence: 0,
  };
  const issues = {
    unexpected_persistence: 0,
    wrong_links: 0,
    missing_events: 0,
    missing_jobs: 0,
    duplicate_jobs: 0,
    duplicate_creations: 0,
    creations_outside_run: 0,
    context_mismatches: 0,
    recipient_mismatches: 0,
    unlinked_new_events: 0,
    unlinked_new_jobs: 0,
  };

  for (const request of requests) {
    const matches = keysByHash.get(request.keyHash) ?? [];
    const stored = matches.find((row) => row.tenant === request.tenant);
    const foreignKey = matches.some((row) => row.tenant !== request.tenant);
    if (request.kind !== "valid" && (matches.length > 0 || request.status === 201)) {
      issues.unexpected_persistence += 1;
      if (foreignKey) issues.context_mismatches += 1;
      continue;
    }
    if (request.kind !== "valid" && request.expected) {
      observations.expected_rejections += 1;
      continue;
    }

    const { response } = request;
    const missingEvidence = !stored || (!response && request.status !== 0 && request.status < 500);
    if (missingEvidence) observations.missing_evidence += 1;
    const link = response ?? stored;
    if (!link) {
      if (foreignKey) issues.context_mismatches += 1;
      continue;
    }

    const { eventId, jobId } = link;
    const repeatedCreation = response?.deduplicated === false && newResponses.has(eventId);
    if (response?.deduplicated === false) {
      newResponses.add(eventId);
    }
    linkedEvents.add(eventId);
    linkedJobs.add(jobId);
    const event = eventsById.get(eventId);
    const job = jobsById.get(jobId);
    const violations = {
      wrong_links: (stored && (stored.eventId !== eventId || stored.jobId !== jobId)) ||
        (job && job.eventId !== eventId),
      missing_events: !event,
      missing_jobs: !job,
      duplicate_jobs: (jobsByEvent.get(eventId)?.length ?? 0) > 1,
      duplicate_creations: repeatedCreation,
      creations_outside_run: response?.deduplicated === false &&
        ((event && !event.newDuringRun) || (job && !job.newDuringRun)),
      context_mismatches: foreignKey || [event, job].some((row) => row &&
        (row.tenant !== request.tenant || row.location !== request.location || !row.locationMatchesTenant)),
      recipient_mismatches: job && !job.recipientMatches,
    };
    const failures = Object.keys(violations).filter((name) => violations[name]);
    for (const name of failures) issues[name] += 1;
    if (!missingEvidence && failures.length === 0) {
      if (!response) observations.matched_without_response += 1;
      else if (response.deduplicated) observations.matched_replays += 1;
      else observations.matched_responses += 1;
    }
  }

  issues.unlinked_new_events = events.filter((row) => row.newDuringRun && !linkedEvents.has(row.eventId)).length;
  issues.unlinked_new_jobs = jobs.filter((row) => row.newDuringRun && !linkedJobs.has(row.jobId)).length;
  const { matched_responses, matched_replays, matched_without_response, missing_evidence } = observations;
  const hasLinks = matched_responses + matched_replays + matched_without_response > 0;
  const status = Object.values(issues).some(Boolean) ? "failed"
    : missing_evidence > 0 || !hasLinks ? "incomplete" : "passed";
  return { status, request_count: requests.length, ...observations, ...issues };
}

export async function reconciliationStart(database) {
  const { rows } = await database.query("SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC')::text AS utc");
  return rows[0].utc;
}

export async function readReconciliationEvidence(database, requests, startedAt) {
  await database.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const { rows: keys } = await database.query(
      `SELECT i.key_hash AS "keyHash", t.tenant_code AS tenant,
              i.scan_event_id AS "eventId", i.mail_job_id AS "jobId"
         FROM scan_request_idempotency i JOIN tenants t ON t.id = i.tenant_id
         WHERE i.route = $1 AND i.key_hash = ANY($2::text[])`,
      [SCAN_ROUTE, [...new Set(requests.map((request) => request.keyHash))]],
    );
    const links = [...keys, ...requests.flatMap((request) => request.response ?? [])];
    const eventIds = [...new Set(links.map((row) => row.eventId))];
    const jobIds = [...new Set(links.map((row) => row.jobId))];
    const { rows: events } = await database.query(
      `SELECT s.id AS "eventId", t.tenant_code AS tenant, l.location_code AS location,
              (l.tenant_id = s.tenant_id) AS "locationMatchesTenant",
              (s.created_at >= $2::timestamp) AS "newDuringRun"
         FROM scan_events s JOIN tenants t ON t.id = s.tenant_id
         LEFT JOIN locations l ON l.id = s.location_id
         WHERE s.id = ANY($1::uuid[]) OR s.created_at >= $2::timestamp`,
      [eventIds, startedAt],
    );
    const { rows: jobs } = await database.query(
      `SELECT j.id AS "jobId", j.scan_event_id AS "eventId", t.tenant_code AS tenant, l.location_code AS location,
              (l.tenant_id = j.tenant_id) AS "locationMatchesTenant",
              (j.created_at >= $3::timestamp) AS "newDuringRun",
              (p.id = j.person_mapping_id AND p.tenant_id = s.tenant_id
               AND p.location_id = s.location_id AND p.email = j.to_email) AS "recipientMatches"
         FROM mail_jobs j JOIN tenants t ON t.id = j.tenant_id
         JOIN locations l ON l.id = j.location_id
         JOIN scan_events s ON s.id = j.scan_event_id
         LEFT JOIN person_mappings p ON p.id = s.person_mapping_id
         WHERE j.scan_event_id = ANY($1::uuid[]) OR j.id = ANY($2::uuid[]) OR j.created_at >= $3::timestamp`,
      [eventIds, jobIds, startedAt],
    );
    await database.query("COMMIT");
    return { keys, events, jobs };
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
