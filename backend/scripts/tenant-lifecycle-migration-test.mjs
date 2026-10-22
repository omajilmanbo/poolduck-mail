import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const source = process.env.DATABASE_URL;
assert(source, "DATABASE_URL is required");
assert(["local", "test"].includes(process.env.APP_ENV), "Local/CI only");
const sourceUrl = new URL(source);
assert(["localhost", "127.0.0.1"].includes(sourceUrl.hostname), "Local PostgreSQL only");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationName = "20261020000000_add_tenant_deletion_lifecycle";
const migrationRoot = path.join(root, "prisma", "migrations");
const migration = await readFile(path.join(migrationRoot, migrationName, "migration.sql"), "utf8");
const rollback = await readFile(path.join(root, "prisma", "rollback", `${migrationName}.sql`), "utf8");
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const admin = new Client({ connectionString: adminUrl.toString() });
const databaseNames = [];

await admin.connect();
try {
  const populatedUrl = await createTemporaryDatabase("populated");
  await testPopulatedMigration(populatedUrl);
  const deployUrl = await createTemporaryDatabase("deploy");
  for (let i = 0; i < 2; i += 1) {
    execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: deployUrl.toString() },
      stdio: "pipe",
    });
  }
  await testEmptyRollback(deployUrl);
  console.log("Tenant lifecycle migration, rollback guard, and repeat deploy passed.");
} finally {
  for (const name of databaseNames.reverse()) {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [name],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
  }
  await admin.end();
}

async function createTemporaryDatabase(suffix) {
  const name = `poolduck_tenant_lifecycle_${suffix}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  assert(/^poolduck_tenant_lifecycle_[a-z0-9_]+$/.test(name));
  await admin.query(`CREATE DATABASE "${name}"`);
  databaseNames.push(name);
  const url = new URL(sourceUrl);
  url.pathname = `/${name}`;
  return url;
}

async function testPopulatedMigration(url) {
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const entries = (await readdir(migrationRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name < migrationName)
      .map((entry) => entry.name)
      .sort();
    for (const entry of entries) {
      await client.query(await readFile(path.join(migrationRoot, entry, "migration.sql"), "utf8"));
    }

    const tenantId = randomUUID();
    await client.query(
      `INSERT INTO "tenants" ("id", "tenant_code", "name", "status", "location_limit", "updated_at")
       VALUES ($1, '10CA000001', 'Synthetic Tenant', 'active', 1, CURRENT_TIMESTAMP)`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO "subscriptions" ("tenant_id", "plan", "status", "start_at", "end_at", "updated_at")
       VALUES ($1, 'synthetic', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '2 years', CURRENT_TIMESTAMP)`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO "users" ("tenant_id", "email", "password_hash", "role", "updated_at")
       VALUES ($1, 'manager@example.local', 'synthetic-not-login-capable', 'tenant_manager', CURRENT_TIMESTAMP)`,
      [tenantId],
    );

    const beforeForeignKeys = await tenantForeignKeys(client);
    await client.query(migration);
    assert.deepEqual(await tenantForeignKeys(client), beforeForeignKeys);
    const unchanged = await client.query(
      `SELECT "status", "deleted_at", "purge_after", "deleted_from_status",
              "deleted_from_subscription_status" FROM "tenants" WHERE "id" = $1`,
      [tenantId],
    );
    assert.deepEqual(unchanged.rows[0], {
      status: "active",
      deleted_at: null,
      purge_after: null,
      deleted_from_status: null,
      deleted_from_subscription_status: null,
    });
    assert.equal((await client.query(`SELECT COUNT(*)::int AS count FROM "users" WHERE "tenant_id" = $1`, [tenantId])).rows[0].count, 1);

    const leap = await client.query(
      `SELECT to_char(TIMESTAMP '2024-02-29 12:00:00' + INTERVAL '1 year', 'YYYY-MM-DD HH24:MI:SS') AS due`,
    );
    assert.equal(leap.rows[0].due, "2025-02-28 12:00:00");
    await client.query(
      `UPDATE "tenants" SET "status" = 'pending_delete',
        "deleted_at" = TIMESTAMP '2024-02-29 12:00:00',
        "purge_after" = TIMESTAMP '2024-02-29 12:00:00' + INTERVAL '1 year',
        "deleted_from_status" = 'active', "deleted_from_subscription_status" = 'active'
       WHERE "id" = $1`,
      [tenantId],
    );
    const boundaries = await client.query(
      `SELECT TIMESTAMP '2025-02-28 11:59:59.999' < "purge_after" AS before,
              TIMESTAMP '2025-02-28 12:00:00' < "purge_after" AS exact,
              TIMESTAMP '2025-02-28 12:00:00.001' < "purge_after" AS after
       FROM "tenants" WHERE "id" = $1`,
      [tenantId],
    );
    assert.deepEqual(boundaries.rows[0], { before: true, exact: false, after: false });

    await assert.rejects(client.query(rollback), /tenant lifecycle rollback blocked/);
    await client.query("ROLLBACK");
    assert.equal((await client.query(`SELECT "status" FROM "tenants" WHERE "id" = $1`, [tenantId])).rows[0].status, "pending_delete");

    await assert.rejects(
      client.query(`UPDATE "tenants" SET "deleted_from_subscription_status" = NULL WHERE "id" = $1`, [tenantId]),
      /tenants_deletion_lifecycle_check/,
    );
    await assert.rejects(
      client.query(`UPDATE "tenants" SET "purge_after" = "deleted_at" + INTERVAL '366 days' WHERE "id" = $1`, [tenantId]),
      /tenants_deletion_lifecycle_check/,
    );

    const contender = new Client({ connectionString: url.toString() });
    await contender.connect();
    try {
      const update = `UPDATE "tenants" SET "status" = 'purged' WHERE "id" = $1 AND "status" = 'pending_delete' RETURNING "id"`;
      const results = await Promise.all([client.query(update, [tenantId]), contender.query(update, [tenantId])]);
      assert.deepEqual(results.map((result) => result.rowCount).sort(), [0, 1]);
    } finally {
      await contender.end();
    }

  } finally {
    await client.end();
  }
}

async function testEmptyRollback(url) {
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query(rollback);
    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'deleted_at'`,
    );
    assert.equal(columns.rowCount, 0);
  } finally {
    await client.end();
  }
}

async function tenantForeignKeys(client) {
  const result = await client.query(
    `SELECT conname FROM pg_constraint WHERE contype = 'f' AND confrelid = 'tenants'::regclass ORDER BY conname`,
  );
  return result.rows.map((row) => row.conname);
}
