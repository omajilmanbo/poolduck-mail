import { config } from "dotenv";

config({ path: "../.env", quiet: true });
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";
const expectedSendStatus = process.env.API_SMOKE_EXPECT_SEND_STATUS ?? "sent";

const smoke = {
  tenantId:
    process.env.API_SMOKE_TENANT_ID ??
    "11111111-1111-4111-8111-111111111111",
  email: process.env.API_SMOKE_EMAIL ?? "manager@example.local",
  password: process.env.API_SMOKE_PASSWORD ?? "PoolduckLocal123!",
  locationId:
    process.env.API_SMOKE_LOCATION_ID ??
    "66666666-6666-4666-8666-666666666666",
  scanCode: process.env.API_SMOKE_SCAN_CODE ?? "SCAN-LOCAL-001",
  unmappedScanCode:
    process.env.API_SMOKE_UNMAPPED_SCAN_CODE ?? "SCAN-LOCAL-UNMAPPED",
};

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
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
      tenant_id: smoke.tenantId,
      email: smoke.email,
      password: smoke.password,
    }),
  });
  assert(login.response.ok, "POST /api/auth/login failed.");
  assert(login.body?.access_token, "Login did not return access_token.");
  const token = login.body.access_token;

  const authHeaders = {
    authorization: `Bearer ${token}`,
  };

  const license = await request("/api/license/check", {
    headers: authHeaders,
  });
  assert(license.response.ok, "GET /api/license/check failed.");
  assert(
    license.body?.can_send === true,
    "Expected active seed tenant to be sendable.",
  );

  const locations = await request("/api/locations", {
    headers: authHeaders,
  });
  assert(locations.response.ok, "GET /api/locations failed.");
  assert(
    Array.isArray(locations.body) &&
      locations.body.some((location) => location.location_id === smoke.locationId),
    "Seed location was not returned.",
  );

  const people = await request(`/api/locations/${smoke.locationId}/people`, {
    headers: authHeaders,
  });
  assert(people.response.ok, "GET /api/locations/{id}/people failed.");
  assert(
    JSON.stringify(people.body).includes("email_masked") &&
      !JSON.stringify(people.body).includes("local-recipient@example.local"),
    "People response should include masked email only.",
  );

  const unmapped = await request("/api/scan-events", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      location_id: smoke.locationId,
      scan_code: smoke.unmappedScanCode,
    }),
  });
  assert(
    unmapped.response.status === 404 &&
      unmapped.body?.code === "SCAN_CODE_NOT_MAPPED" &&
      unmapped.body?.scan_event_id,
    "Unmapped scan_code did not create an abnormal scan_event.",
  );

  const scan = await request("/api/scan-events", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      location_id: smoke.locationId,
      scan_code: smoke.scanCode,
    }),
  });
  assert(scan.response.ok, "POST /api/scan-events failed.");
  assert(scan.body?.mail_job_id, "Scan did not create mail_job.");
  assert(scan.body?.status === "queued", "Expected scan to create queued mail_job.");

  const send = await request(`/api/mail-jobs/${scan.body.mail_job_id}/send`, {
    method: "POST",
    headers: authHeaders,
  });
  assert(send.response.ok, "POST /api/mail-jobs/{id}/send failed.");
  assert(
    send.body?.status === expectedSendStatus,
    `Expected send status ${expectedSendStatus}, got ${send.body?.status}.`,
  );

  console.log("API smoke test completed.");
  console.log(
    JSON.stringify(
      {
        tenant_id: smoke.tenantId,
        location_id: smoke.locationId,
        scan_event_id: scan.body.scan_event_id,
        mail_job_id: scan.body.mail_job_id,
        send_status: send.body.status,
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
