import { readFile } from 'node:fs/promises';

async function check(connectionString) {
  const url = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname.length < 2 ||
      url.searchParams.getAll('schema').some((schema) => schema !== 'public')) {
    throw new Error('unsupported database target');
  }
  const { Client } = await import('pg');
  const sql = await readFile(new URL('./offline-integrity.sql', import.meta.url), 'utf8');
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // A tenant-filtered role must fail rather than count only its visible rows.
    await client.query('SET LOCAL row_security = off');
    await client.query('SET LOCAL search_path = pg_catalog');
    const { rows: [row] } = await client.query(sql);
    const counts = {};
    for (const [key, value] of Object.entries(row)) {
      const count = Number(value);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('invalid count');
      counts[key] = count;
    }
    await client.query('COMMIT');
    return counts;
  } finally {
    // Closing the connection also aborts an incomplete transaction.
    await client.end();
  }
}

try {
  const counts = await check(process.env.DATABASE_URL);
  const violations = Object.values(counts).some((count) => count > 0);
  console.log(JSON.stringify({ result: violations ? 'violations' : 'ok', counts }));
  process.exitCode = violations ? 1 : 0;
} catch {
  // Driver/SQL errors can contain connection details or row values.
  console.log(JSON.stringify({ result: 'unavailable' }));
  process.exitCode = 2;
}
