import { Client } from "pg";
import { config } from "dotenv";

config({ path: "../.env", quiet: true });
config({ path: ".env", quiet: true });
config({ path: ".env.local", override: true, quiet: true });

const connectionString = process.env.DATABASE_URL;
const tenantCode = process.env.CAPACITY_TENANT_CODE ?? "5A6E116001";
const startedAt = new Date(process.env.CAPACITY_RUN_STARTED_AT ?? "");
const finishedAt = new Date(process.env.CAPACITY_RUN_FINISHED_AT ?? "");

if (!connectionString) throw new Error("DATABASE_URL is required.");
if (Number.isNaN(startedAt.getTime()) || Number.isNaN(finishedAt.getTime()) || finishedAt <= startedAt) {
  throw new Error("CAPACITY_RUN_STARTED_AT and CAPACITY_RUN_FINISHED_AT must define a valid interval.");
}
if (process.env.APP_ENV === "production") throw new Error("Capacity report refuses APP_ENV=production.");

const database = new Client({ connectionString });

function numericRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value === null || value === undefined ? null : Number(value)]),
  );
}

async function main() {
  await database.connect();
  const tenant = await database.query("SELECT id FROM tenants WHERE tenant_code = $1", [tenantCode]);
  if (tenant.rowCount !== 1) throw new Error("Capacity tenant was not found.");
  const tenantId = tenant.rows[0].id;
  const [summary, statuses, databaseState] = await Promise.all([
    database.query(
      `SELECT
         COUNT(*)::int AS mail_jobs,
         COUNT(claimed_at)::int AS claimed_jobs,
         COUNT(*) FILTER (WHERE claimed_at < send_not_before)::int AS early_claims,
         COALESCE(ROUND((percentile_cont(0.50) WITHIN GROUP
           (ORDER BY EXTRACT(EPOCH FROM (claimed_at - send_not_before)) * 1000)
           FILTER (WHERE claimed_at IS NOT NULL))::numeric, 3), 0) AS claim_p50_ms,
         COALESCE(ROUND((percentile_cont(0.95) WITHIN GROUP
           (ORDER BY EXTRACT(EPOCH FROM (claimed_at - send_not_before)) * 1000)
           FILTER (WHERE claimed_at IS NOT NULL))::numeric, 3), 0) AS claim_p95_ms,
         COALESCE(ROUND((percentile_cont(0.99) WITHIN GROUP
           (ORDER BY EXTRACT(EPOCH FROM (claimed_at - send_not_before)) * 1000)
           FILTER (WHERE claimed_at IS NOT NULL))::numeric, 3), 0) AS claim_p99_ms,
         COUNT(*) FILTER (WHERE status IN ('waiting', 'queued', 'processing'))::int AS backlog
       FROM mail_jobs
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [tenantId, startedAt, finishedAt],
    ),
    database.query(
      `SELECT status, COUNT(*)::int AS count
       FROM mail_jobs
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
       GROUP BY status ORDER BY status`,
      [tenantId, startedAt, finishedAt],
    ),
    database.query(
      `SELECT
         (SELECT COUNT(*) FROM pg_stat_activity)::int AS connections,
         (SELECT COUNT(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock')::int AS lock_waiters,
         (SELECT COUNT(*) FROM pg_locks WHERE NOT granted)::int AS ungranted_locks`,
    ),
  ]);
  const durationSeconds = (finishedAt.getTime() - startedAt.getTime()) / 1_000;
  const aggregate = numericRow(summary.rows[0]);
  console.log(
    JSON.stringify(
      {
        event: "capacity_db.report",
        tenant_code: tenantCode,
        run_started_at: startedAt.toISOString(),
        run_finished_at: finishedAt.toISOString(),
        duration_seconds: durationSeconds,
        mail_jobs_per_second: Number((aggregate.mail_jobs / durationSeconds).toFixed(3)),
        ...aggregate,
        status_counts: Object.fromEntries(statuses.rows.map((row) => [row.status, Number(row.count)])),
        database: numericRow(databaseState.rows[0]),
      },
      null,
      2,
    ),
  );
}

main()
  .finally(async () => {
    await database.end();
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
