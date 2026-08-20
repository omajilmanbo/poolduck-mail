import { config } from "dotenv";
import { Client } from "pg";

config({ path: "../.env", quiet: true });
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";
const expectedCreateStatus = process.env.API_SMOKE_EXPECT_SEND_STATUS ?? "waiting";
let sessionCookie = "";

const smoke = {
  tenantCode:
    process.env.API_SMOKE_TENANT_CODE ??
    "10CA000001",
  identifier:
    process.env.API_SMOKE_IDENTIFIER ??
    process.env.API_SMOKE_EMAIL ??
    "local-operator",
  password: process.env.API_SMOKE_PASSWORD ?? "PoolduckLocal123!",
  locationId:
    process.env.API_SMOKE_LOCATION_ID ??
    "10CA1001",
  scanCode:
    process.env.API_SMOKE_SCAN_CODE ?? "V2E01K0ABC10001",
  unmappedScanCode:
    process.env.API_SMOKE_UNMAPPED_SCAN_CODE ??
    "V2E01K0ABC19999",
};

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    sessionCookie = setCookie
      .split(/,(?=\s*poolduck_)/)
      .map((value) => value.trim().split(";")[0])
      .join("; ");
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;

  return { response, body };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  console.log(`Running API smoke test against ${API_BASE_URL}`);

  const health = await request("/health");
  assert(health.response.ok, "GET /health failed.");

  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      tenant_code: smoke.tenantCode,
      identifier: smoke.identifier,
      password: smoke.password,
    }),
  });
  assert(login.response.ok, "POST /api/auth/login failed.");
  assert(sessionCookie.includes("poolduck_access="), "Login did not set the access cookie.");

  const license = await request("/api/license/check");
  assert(license.response.ok, "GET /api/license/check failed.");
  assert(
    license.body?.can_send === true,
    "Expected active seed tenant to be sendable.",
  );

  const locations = await request("/api/locations");
  assert(locations.response.ok, "GET /api/locations failed.");
  assert(
    Array.isArray(locations.body) &&
      locations.body.some((location) => location.location_id === smoke.locationId),
    "Seed location was not returned.",
  );

  const people = await request(`/api/locations/${smoke.locationId}/people`);
  assert(people.response.ok, "GET /api/locations/{id}/people failed.");
  assert(
    JSON.stringify(people.body).includes("email_masked") &&
      !JSON.stringify(people.body).includes("local-recipient@example.local"),
    "People response should include masked email only.",
  );

  const unmapped = await request("/api/scan-events", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      location_id: smoke.locationId,
      scan_code: smoke.unmappedScanCode,
    }),
  });
  assert(
    unmapped.response.status === 404 &&
      unmapped.body?.code === "SCAN_CODE_NOT_MAPPED" &&
      !("scan_event_id" in (unmapped.body ?? {})),
    `Unmapped action code was not rejected without persistence: ${unmapped.response.status} ${JSON.stringify(unmapped.body)}`,
  );

  const scan = await request("/api/scan-events", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      location_id: smoke.locationId,
      scan_code: smoke.scanCode,
    }),
  });
  assert(scan.response.ok, "POST /api/scan-events failed.");
  assert(scan.body?.mail_job_id, "Scan did not create mail_job.");
  assert(
    scan.body?.action === "entry" &&
      scan.body?.action_source === "person_action_code",
    "Scan did not persist the ENTRY action.",
  );
  assert(
    scan.body?.status === expectedCreateStatus &&
      scan.body?.mail_status === expectedCreateStatus &&
      typeof scan.body?.server_time === "string",
    `Expected initial send status ${expectedCreateStatus}, got ${scan.body?.status}.`,
  );

  const cancellation = await request(
    `/api/scan-events/${scan.body.scan_event_id}/cancel`,
    { method: "POST" },
  );
  assert(
    cancellation.response.ok &&
      cancellation.body?.effective_status === "canceled" &&
      cancellation.body?.mail_status === "canceled" &&
      typeof cancellation.body?.canceled_at === "string",
    `Cancellation failed: ${cancellation.response.status} ${JSON.stringify(cancellation.body)}`,
  );

  const rescan = await request("/api/scan-events", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      location_id: smoke.locationId,
      scan_code: smoke.scanCode,
    }),
  });
  assert(
    rescan.response.ok &&
      rescan.body?.status === "waiting" &&
      rescan.body?.scan_event_id !== scan.body.scan_event_id,
    "A new idempotency key did not create a fresh waiting event after cancellation.",
  );

  let delivered;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(1_000);
    delivered = await request(`/api/scan-events/${rescan.body.scan_event_id}`);
    if (delivered.response.ok && delivered.body?.mail_status === "sent") break;
  }
  assert(
    delivered?.response.ok && delivered.body?.mail_status === "sent",
    `Uncanceled waiting task was not sent by the worker: ${JSON.stringify(delivered?.body)}`,
  );

  let deliveryEvidence = { database_check: "skipped" };
  if (process.env.DATABASE_URL) {
    const database = new Client({ connectionString: process.env.DATABASE_URL });
    await database.connect();
    try {
      const evidence = await database.query(
        `SELECT
           mj.id,
           mj.status,
           mj.send_not_before,
           mj.claimed_at,
           COUNT(mda.id)::int AS attempt_count,
           COUNT(mda.provider_invoked_at)::int AS provider_invocation_count
         FROM mail_jobs mj
         LEFT JOIN mail_delivery_attempts mda ON mda.mail_job_id = mj.id
         WHERE mj.id = ANY($1::uuid[])
         GROUP BY mj.id`,
        [[scan.body.mail_job_id, rescan.body.mail_job_id]],
      );
      const canceled = evidence.rows.find((row) => row.id === scan.body.mail_job_id);
      const sent = evidence.rows.find((row) => row.id === rescan.body.mail_job_id);
      assert(
        canceled?.status === "canceled" &&
          canceled.attempt_count === 0 &&
          canceled.provider_invocation_count === 0,
        "Canceled smoke job created a provider attempt.",
      );
      assert(
        sent?.status === "sent" &&
          sent.attempt_count === 1 &&
          sent.provider_invocation_count === 1 &&
          sent.claimed_at >= sent.send_not_before,
        "Delivered smoke job did not have one post-deadline provider attempt.",
      );
      deliveryEvidence = {
        database_check: "passed",
        canceled_attempts: canceled.attempt_count,
        canceled_provider_invocations: canceled.provider_invocation_count,
        sent_attempts: sent.attempt_count,
        sent_provider_invocations: sent.provider_invocation_count,
        early_claims: 0,
      };
    } finally {
      await database.end();
    }
  }

  console.log("API smoke test completed.");
  console.log(
    JSON.stringify(
      {
        initial_send_status: scan.body.status,
        final_send_status: cancellation.body.mail_status,
        rescan_final_status: delivered.body.mail_status,
        ...deliveryEvidence,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
