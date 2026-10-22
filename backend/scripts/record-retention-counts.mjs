import assert from 'node:assert/strict';
import { Client } from 'pg';

// Read-only snapshot for ADR-024 release verification. No names, addresses,
// message bodies, payloads, secrets or connection details are printed.
assert(process.env.DATABASE_URL, 'DATABASE_URL is required');
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const clock = await client.query("SELECT (transaction_timestamp() AT TIME ZONE 'UTC') AS captured_at");
  const rows = await client.query(`
    WITH scan_counts AS (
      SELECT tenant_id, count(*) AS total,
        count(*) FILTER (WHERE created_at + INTERVAL '1 year' <= (transaction_timestamp() AT TIME ZONE 'UTC')) AS due
      FROM scan_events GROUP BY tenant_id
    ), mail_counts AS (SELECT tenant_id, count(*) AS total FROM mail_jobs GROUP BY tenant_id),
    attempt_counts AS (SELECT tenant_id, count(*) AS total FROM mail_delivery_attempts GROUP BY tenant_id),
    audit_counts AS (
      SELECT tenant_id, count(*) AS total,
        count(*) FILTER (WHERE created_at + INTERVAL '1 year' <= (transaction_timestamp() AT TIME ZONE 'UTC')) AS due
      FROM audit_logs WHERE tenant_id IS NOT NULL GROUP BY tenant_id
    ), platform_counts AS (
      SELECT target_tenant_id AS tenant_id, count(*) AS total,
        count(*) FILTER (WHERE created_at + INTERVAL '1 year' <= (transaction_timestamp() AT TIME ZONE 'UTC')) AS due
      FROM platform_audit_logs WHERE target_tenant_id IS NOT NULL GROUP BY target_tenant_id
    )
    SELECT t.id AS tenant_id, t.status,
      coalesce(s.total, 0) AS scan_events, coalesce(s.due, 0) AS due_scan_events,
      coalesce(m.total, 0) AS mail_jobs, coalesce(a.total, 0) AS attempts,
      coalesce(b.total, 0) AS business_audits, coalesce(b.due, 0) AS due_business_audits,
      coalesce(p.total, 0) AS platform_audits, coalesce(p.due, 0) AS due_platform_audits
    FROM tenants t LEFT JOIN scan_counts s ON s.tenant_id = t.id
      LEFT JOIN mail_counts m ON m.tenant_id = t.id
      LEFT JOIN attempt_counts a ON a.tenant_id = t.id
      LEFT JOIN audit_counts b ON b.tenant_id = t.id
      LEFT JOIN platform_counts p ON p.tenant_id = t.id
    ORDER BY t.id`);
  const unbound = await client.query(`
    SELECT
      (SELECT count(*) FROM audit_logs WHERE tenant_id IS NULL) AS business_audits,
      (SELECT count(*) FROM platform_audit_logs WHERE target_tenant_id IS NULL) AS platform_audits`);
  await client.query('COMMIT');
  const keys = ['scan_events', 'due_scan_events', 'mail_jobs', 'attempts',
    'business_audits', 'due_business_audits', 'platform_audits', 'due_platform_audits'];
  console.log(JSON.stringify({
    captured_at: clock.rows[0].captured_at,
    tenants: rows.rows.map((row) => ({ tenant_id: row.tenant_id, status: row.status,
      ...Object.fromEntries(keys.map((key) => [key, Number(row[key])])) })),
    unbound: Object.fromEntries(Object.entries(unbound.rows[0]).map(([key, value]) => [key, Number(value)])),
  }));
} finally {
  await client.end();
}
