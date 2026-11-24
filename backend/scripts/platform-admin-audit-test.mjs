import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL is required");
const target = new URL(databaseUrl);
assert.ok(["local", "test"].includes(process.env.APP_ENV), "Local test environment required");
assert.ok(target.protocol === "postgresql:" && target.hostname === "127.0.0.1"
  && target.pathname === "/poolduck_cli_audit_test" && ["", "?schema=public"].includes(target.search),
  "Use a disposable loopback PostgreSQL database named poolduck_cli_audit_test");
assert.ok(!existsSync(new URL("../.env.local", import.meta.url)), "backend/.env.local can override the test database");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const email = `cli-${randomBytes(8).toString("hex")}@example.local`;
const otherEmail = `other-${randomBytes(8).toString("hex")}@example.local`;
const makePassword = () => randomBytes(24).toString("hex");
const firstPassword = makePassword();
const rotatedPassword = makePassword();
const recoveredPassword = makePassword();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const orderById = { orderBy: { id: "asc" } };
const successMessages = {
  bootstrap: "platform_admin bootstrap completed.",
  rotate: "platform_admin password rotated and all sessions revoked.",
  disable: "platform_admin disabled and all sessions revoked.",
  recover: "platform_admin recovered and all prior sessions revoked.",
};
const requestIds = new Set();

function runCli(command, env) {
  const { error, status, stdout, stderr } = spawnSync(process.execPath, ["scripts/platform-admin.mjs", command], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, PLATFORM_ADMIN_EMAIL: ` ${email.toUpperCase()} `, PLATFORM_ADMIN_PASSWORD: "", ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (error) throw error;
  return { status, stdout, stderr };
}

function snapshot() {
  return Promise.all([
    prisma.platformAdmin.findMany(orderById),
    prisma.platformSession.findMany(orderById),
    prisma.platformAuditLog.findMany(orderById),
  ]);
}

async function reject(command, message, env = {}) {
  const before = await snapshot();
  const { status, stdout, stderr } = runCli(command, env);
  assert.equal(status, 1, `${command} rejection exit code`);
  assert.ok(stdout === "" && stderr.includes(message), `${command} rejection output`);
  assert.ok(isDeepStrictEqual(await snapshot(), before), `${command} rejection must leave account, sessions and audit intact`);
}

async function succeed(command, password = "") {
  const before = await prisma.platformAuditLog.count();
  const { status, stdout, stderr } = runCli(command, { PLATFORM_ADMIN_PASSWORD: password });
  assert.equal(status, 0, `${command} success exit code`);
  assert.ok(stderr === "", `${command} success stderr`);
  const match = stdout.match(/^(.*) request_id=([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\r?\n$/);
  assert.ok(match && match[1] === successMessages[command], `${command} must emit only its success message and a UUID v4`);
  const requestId = match[2];
  assert.ok(!requestIds.has(requestId), "Each success must have its own request ID");
  requestIds.add(requestId);

  const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email } });
  const rows = await prisma.platformAuditLog.findMany({ where: { requestId } });
  assert.equal(rows.length, 1, `${command} request ID must identify one audit row`);
  assert.equal(await prisma.platformAuditLog.count(), before + 1);
  const [audit] = rows;
  assert.equal(audit.action, `platform.admin.${command}`);
  assert.equal(audit.resourceType, "platform_admin");
  assert.equal(audit.result, "success");
  assert.ok(audit.platformAdminId === admin.id && audit.resourceId === admin.id && audit.targetTenantId === null);
  const metadata = command === "bootstrap" ? { identity_hash: sha256(email) } : {};
  assert.ok(isDeepStrictEqual(audit.metadataJson, metadata), `${command} audit metadata must keep the existing shape`);
  console.log(`${command}: exit 0, unique request ID matched one success audit, safe stdout`);
  return admin;
}

async function addSession(admin) {
  return prisma.platformSession.create({
    data: {
      platformAdminId: admin.id,
      identityVersionSnapshot: admin.identityVersion,
      refreshTokenHash: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
}

async function assertRevoked(...sessions) {
  const rows = await prisma.platformSession.findMany({ where: { id: { in: sessions.map(({ id }) => id) } } });
  assert.equal(rows.length, sessions.length);
  assert.ok(rows.every(({ revokedAt }) => revokedAt instanceof Date), "Existing sessions must be revoked");
}

async function assertIdentity(admin, expectedStatus, version, password) {
  assert.equal(admin.status, expectedStatus);
  assert.equal(admin.identityVersion, version);
  assert.ok(await argon2.verify(admin.passwordHash, password), "Expected credential must match");
  assert.equal(await prisma.platformAdmin.count({ where: { status: "active" } }), expectedStatus === "active" ? 1 : 0);
}

async function rejectAuditInsert(command, password) {
  await prisma.$executeRaw`ALTER TABLE platform_audit_logs ADD CONSTRAINT cli_test_reject_new_id
    CHECK (request_id IS NULL) NOT VALID`;
  try {
    await reject(command, "cli_test_reject_new_id", { PLATFORM_ADMIN_PASSWORD: password });
  } finally {
    await prisma.$executeRaw`ALTER TABLE platform_audit_logs DROP CONSTRAINT cli_test_reject_new_id`;
  }
  console.log(`${command}: audit insert failure exited 1 and rolled back the entire operation`);
}

try {
  const empty = await snapshot();
  assert.ok(empty.every((rows) => rows.length === 0) && await prisma.tenant.count() === 0,
    "Start with an empty migrated database");

  await reject("bootstrap", "DATABASE_URL is required", { DATABASE_URL: "" });
  await reject("invalid", "Usage: node scripts/platform-admin.mjs");
  await reject("bootstrap", "PLATFORM_ADMIN_EMAIL is required", { PLATFORM_ADMIN_EMAIL: "" });
  for (const command of ["bootstrap", "rotate", "recover"]) {
    await reject(command, "PLATFORM_ADMIN_PASSWORD must contain at least 16 characters");
  }
  for (const command of ["disable", "rotate", "recover"]) {
    await reject(command, "platform_admin was not found", { PLATFORM_ADMIN_PASSWORD: firstPassword });
  }
  console.log("Input validation and unknown accounts: exit 1 with no audit or state changes");

  await rejectAuditInsert("bootstrap", firstPassword);
  const bootstrapped = await succeed("bootstrap", firstPassword);
  await assertIdentity(bootstrapped, "active", 1, firstPassword);
  await reject("bootstrap", "An active platform_admin already exists", { PLATFORM_ADMIN_PASSWORD: rotatedPassword });
  const firstSession = await addSession(bootstrapped);
  const secondSession = await addSession(bootstrapped);

  const other = await prisma.platformAdmin.create({
    data: { email: otherEmail, passwordHash: await argon2.hash(makePassword()), status: "disabled" },
  });
  const legacy = await prisma.platformAuditLog.create({
    data: {
      platformAdminId: other.id, resourceType: "platform_admin", resourceId: other.id,
      action: "platform.admin.bootstrap", result: "success", metadataJson: { identity_hash: sha256(otherEmail) },
    },
  });
  assert.equal(legacy.requestId, null);
  await reject("recover", "Another active platform_admin exists", {
    PLATFORM_ADMIN_EMAIL: otherEmail, PLATFORM_ADMIN_PASSWORD: recoveredPassword,
  });

  await rejectAuditInsert("rotate", rotatedPassword);
  const rotated = await succeed("rotate", rotatedPassword);
  await assertIdentity(rotated, "active", 2, rotatedPassword);
  assert.ok(!(await argon2.verify(rotated.passwordHash, firstPassword)));
  await assertRevoked(firstSession, secondSession);
  const thirdSession = await addSession(rotated);

  await rejectAuditInsert("disable", "");
  const disabled = await succeed("disable");
  await assertIdentity(disabled, "disabled", 3, rotatedPassword);
  await assertRevoked(firstSession, secondSession, thirdSession);
  await assertIdentity(await succeed("disable"), "disabled", 4, rotatedPassword);
  await reject("bootstrap", "Account already exists; use recover instead", { PLATFORM_ADMIN_PASSWORD: firstPassword });
  await reject("rotate", "Disabled account requires recover", { PLATFORM_ADMIN_PASSWORD: firstPassword });
  console.log("Lifecycle refusals: active/disabled bootstrap, disabled rotate, and recovery with another active account exited 1");

  await rejectAuditInsert("recover", recoveredPassword);
  const recovered = await succeed("recover", recoveredPassword);
  await assertIdentity(recovered, "active", 5, recoveredPassword);
  assert.ok(!(await argon2.verify(recovered.passwordHash, rotatedPassword)));
  const fourthSession = await addSession(recovered);
  await rejectAuditInsert("recover", firstPassword);
  await assertIdentity(await succeed("recover", firstPassword), "active", 6, firstPassword);
  await assertRevoked(firstSession, secondSession, thirdSession, fourthSession);

  assert.ok(isDeepStrictEqual(await prisma.platformAuditLog.findUnique({ where: { id: legacy.id } }), legacy),
    "The legacy audit must remain readable and unchanged");
  assert.equal(await prisma.mailJob.count(), 0);
  assert.equal(await prisma.mailDeliveryAttempt.count(), 0);
  console.log("Legacy NULL request_id retained; session revocation, identity versions and password verification passed; 0 mail jobs or attempts");
} finally {
  await prisma.$disconnect();
}
