import { randomBytes, randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: "../.env", quiet: true });
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

if (process.env.NODE_ENV === "production" || process.env.APP_ENV === "production") {
  throw new Error("Synthetic platform smoke is forbidden in Production.");
}
if (process.env.PLATFORM_SMOKE !== "true") {
  throw new Error("Set PLATFORM_SMOKE=true to opt in.");
}

const baseUrl = (process.env.API_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const platformEmail = process.env.PLATFORM_SMOKE_EMAIL?.trim().toLowerCase();
const platformPassword = process.env.PLATFORM_SMOKE_PASSWORD;
if (!platformEmail?.endsWith(".example.local")) {
  throw new Error("PLATFORM_SMOKE_EMAIL must use .example.local.");
}
if (!platformPassword || platformPassword.length < 16) {
  throw new Error("PLATFORM_SMOKE_PASSWORD must contain at least 16 characters.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const header = response.headers.get("set-cookie");
  return header ? [header] : [];
}

function updateJar(response, jar) {
  for (const cookie of readSetCookies(response)) {
    const pair = cookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}

async function call(path, { method = "GET", body, headers = {}, jar = new Map() } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(jar.size
        ? { Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") }
        : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  updateJar(response, jar);
  const payload = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : null;
  return { response, payload };
}

async function expectStatus(path, options, status) {
  const result = await call(path, options);
  assert(
    result.response.status === status,
    `${options?.method ?? "GET"} ${path} expected ${status}, received ${result.response.status}`,
  );
  return result.payload;
}

async function main() {
  const platformJar = new Map();
  const tenantJar = new Map();
  await expectStatus(
    "/api/platform/auth/login",
    {
      method: "POST",
      jar: platformJar,
      body: { email: platformEmail, password: platformPassword },
    },
    201,
  );
  await expectStatus("/api/platform/auth/me", { jar: platformJar }, 200);
  await expectStatus("/api/locations", { jar: platformJar }, 401);

  const idempotencyKey = randomUUID();
  const suffix = Date.now().toString(36);
  const managerEmail = `manager-${suffix}@smoke.example.local`;
  const startAt = new Date();
  const endAt = new Date(startAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  const createBody = {
    name: `Platform Smoke ${suffix}`,
    manager_email: managerEmail,
    subscription_status: "trial",
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    location_limit: 2,
  };
  const created = await expectStatus(
    "/api/platform/tenants",
    {
      method: "POST",
      jar: platformJar,
      headers: { "Idempotency-Key": idempotencyKey, "X-Request-Id": randomUUID() },
      body: createBody,
    },
    201,
  );
  assert(created.temporary_password, "tenant creation did not return a temporary password");
  const replay = await expectStatus(
    "/api/platform/tenants",
    {
      method: "POST",
      jar: platformJar,
      headers: { "Idempotency-Key": idempotencyKey, "X-Request-Id": randomUUID() },
      body: createBody,
    },
    201,
  );
  assert(replay.idempotency_replayed === true, "idempotency replay was not detected");
  assert(
    replay.tenant_code === created.tenant_code,
    "idempotency replay created a different tenant",
  );
  await expectStatus(
    "/api/platform/tenants",
    {
      method: "POST",
      jar: platformJar,
      headers: { "Idempotency-Key": idempotencyKey },
      body: { ...createBody, name: `${createBody.name} changed` },
    },
    409,
  );

  const initialLogin = await expectStatus(
    "/api/auth/login",
    {
      method: "POST",
      jar: tenantJar,
      body: {
        tenant_code: created.tenant_code,
        identifier: managerEmail,
        password: created.temporary_password,
      },
    },
    201,
  );
  assert(
    initialLogin.user.must_change_password === true,
    "temporary manager was not forced to change password",
  );
  await expectStatus("/api/platform/tenants", { jar: tenantJar }, 401);
  const managerPassword = `A1a!${randomBytes(18).toString("base64url")}`;
  await expectStatus(
    "/api/auth/change-initial-password",
    { method: "POST", jar: tenantJar, body: { new_password: managerPassword } },
    201,
  );
  await expectStatus(
    "/api/auth/login",
    {
      method: "POST",
      jar: tenantJar,
      body: {
        tenant_code: created.tenant_code,
        identifier: managerEmail,
        password: managerPassword,
      },
    },
    201,
  );
  await expectStatus(
    "/api/locations",
    { method: "POST", jar: tenantJar, body: { location_name: "Smoke One" } },
    201,
  );
  await expectStatus(
    "/api/locations",
    { method: "POST", jar: tenantJar, body: { location_name: "Smoke Two" } },
    201,
  );
  const reached = await expectStatus(
    "/api/locations",
    { method: "POST", jar: tenantJar, body: { location_name: "Smoke Three" } },
    409,
  );
  assert(reached.code === "LOCATION_LIMIT_REACHED", "quota rejection code changed");

  let current = await expectStatus(
    `/api/platform/tenants/${created.tenant_code}`,
    { jar: platformJar },
    200,
  );
  const below = await expectStatus(
    `/api/platform/tenants/${created.tenant_code}/location-limit`,
    {
      method: "PATCH",
      jar: platformJar,
      body: { location_limit: 1, version: current.platform_version },
    },
    409,
  );
  assert(
    below.code === "LOCATION_LIMIT_BELOW_CURRENT_USAGE",
    "below-usage quota rejection code changed",
  );
  current = await expectStatus(
    `/api/platform/tenants/${created.tenant_code}/location-limit`,
    {
      method: "PATCH",
      jar: platformJar,
      body: { location_limit: 3, version: current.platform_version },
    },
    200,
  );
  current = await expectStatus(
    `/api/platform/tenants/${created.tenant_code}/subscription`,
    {
      method: "PATCH",
      jar: platformJar,
      body: {
        status: "suspended",
        start_at: current.subscription.start_at,
        end_at: current.subscription.end_at,
        version: current.subscription.version,
      },
    },
    200,
  );
  current = await expectStatus(
    `/api/platform/tenants/${created.tenant_code}/subscription`,
    {
      method: "PATCH",
      jar: platformJar,
      body: {
        status: "active",
        start_at: current.subscription.start_at,
        end_at: current.subscription.end_at,
        version: current.subscription.version,
      },
    },
    200,
  );
  assert(
    current.recent_platform_operation?.audit_id,
    "platform audit summary was not returned",
  );
  const serialized = JSON.stringify(current);
  assert(!serialized.includes(managerEmail), "platform summary exposed a full manager email");
  assert(!serialized.includes(managerPassword), "platform summary exposed a password");

  await expectStatus(
    "/api/platform/auth/refresh",
    { method: "POST", jar: platformJar },
    201,
  );
  await expectStatus(
    "/api/platform/auth/logout",
    { method: "POST", jar: platformJar },
    201,
  );
  console.log("Platform API smoke passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Platform API smoke failed.");
  process.exitCode = 1;
});
