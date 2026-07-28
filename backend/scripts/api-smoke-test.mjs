import { config } from "dotenv";

config({ path: "../.env", quiet: true });
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";
const expectedSendStatus = process.env.API_SMOKE_EXPECT_SEND_STATUS ?? "sent";
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
    process.env.API_SMOKE_SCAN_CODE ?? "PD1|ENTRY|01K0ABC10001",
  unmappedScanCode:
    process.env.API_SMOKE_UNMAPPED_SCAN_CODE ??
    "PD1|ENTRY|01K0ABC19999",
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
      unmapped.body?.scan_event_id,
    `Unmapped scan_code did not create an abnormal scan_event: ${unmapped.response.status} ${JSON.stringify(unmapped.body)}`,
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
    scan.body?.status === expectedSendStatus,
    `Expected automatic send status ${expectedSendStatus}, got ${scan.body?.status}.`,
  );

  console.log("API smoke test completed.");
  console.log(
    JSON.stringify(
      {
        tenant_code: smoke.tenantCode,
        location_id: smoke.locationId,
        scan_event_id: scan.body.scan_event_id,
        mail_job_id: scan.body.mail_job_id,
        send_status: scan.body.status,
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
