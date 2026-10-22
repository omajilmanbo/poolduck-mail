import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const source = process.env.DATABASE_URL;
assert(source, 'DATABASE_URL is required');
assert(['local', 'test'].includes(process.env.APP_ENV), 'Local/CI only');
const sourceUrl = new URL(source);
assert(['localhost', '127.0.0.1'].includes(sourceUrl.hostname), 'Local PostgreSQL only');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseName = `poolduck_scheduler_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString() });

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
    cwd: root, env: { ...process.env, DATABASE_URL: testUrl.toString() }, stdio: 'pipe',
  });
  process.env.DATABASE_URL = testUrl.toString();
  process.env.APP_ENV = 'production';
  const { PrismaService } = await import('../dist/prisma.service.js');
  const { PlatformAuditService } = await import('../dist/platform/platform-audit.service.js');
  const { PlatformTenantPurgeService } = await import('../dist/platform/platform-tenant-purge.service.js');
  const { PlatformTenantPurgeSchedulerService } = await import('../dist/platform/platform-tenant-purge-scheduler.service.js');
  const db = new PrismaService();
  const db2 = new PrismaService();
  const logs = [];
  const makeScheduler = (prisma) => {
    const scheduler = new PlatformTenantPurgeSchedulerService(prisma,
      new PlatformTenantPurgeService(prisma, new PlatformAuditService(prisma)));
    scheduler.logger.log = (message) => logs.push(message);
    scheduler.logger.error = (message) => logs.push(message);
    return scheduler;
  };
  try {
    const ids = [];
    for (let i = 0; i < 25; i += 1) {
      const tenant = await db.tenant.create({ data: {
        tenantCode: `10PD${String(i).padStart(6, '0')}`, name: `Synthetic ${i}`, locationLimit: 1,
        subscription: { create: { plan: 'manual', status: 'suspended',
          startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000) } },
      } });
      ids.push(tenant.id);
      await db.$executeRaw`UPDATE tenants SET status = 'pending_delete',
        deleted_at = (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 year' - INTERVAL '1 hour',
        purge_after = (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 hour',
        deleted_from_status = 'active', deleted_from_subscription_status = 'trial'
        WHERE id = ${tenant.id}::uuid`;
    }
    const first = makeScheduler(db);
    const second = makeScheduler(db2);
    const runs = await Promise.all([first.runOnce(), second.runOnce()]);
    assert.equal(runs.reduce((total, row) => total + row.purged, 0), 20);
    assert.equal(await db.tenant.count({ where: { status: 'pending_delete' } }), 5);
    const restarted = makeScheduler(db2);
    const final = await restarted.runOnce();
    assert.equal(final.purged, 5);
    assert.equal(final.pending, 0);
    assert.equal(await db.platformAuditLog.count({ where: { action: 'platform.tenant.purged' } }), 25);
    assert.equal((await restarted.runOnce()).purged, 0);
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: ids[0] } })).status, 'purged');

    await db.$executeRaw`CREATE FUNCTION reject_synthetic_purge() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.status = 'purged' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`;
    await db.$executeRaw`CREATE TRIGGER reject_synthetic_purge BEFORE UPDATE ON tenants
      FOR EACH ROW EXECUTE FUNCTION reject_synthetic_purge()`;
    const retryTenant = await db.tenant.create({ data: {
      tenantCode: '10PD000025', name: 'Synthetic retry', locationLimit: 1,
      subscription: { create: { plan: 'manual', status: 'suspended',
        startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000) } },
    } });
    await db.$executeRaw`UPDATE tenants SET status = 'pending_delete',
      deleted_at = (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 year' - INTERVAL '1 hour',
      purge_after = (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 hour',
      deleted_from_status = 'active', deleted_from_subscription_status = 'trial'
      WHERE id = ${retryTenant.id}::uuid`;
    const failure = await restarted.runOnce();
    assert.equal(failure.failed, 1);
    assert.equal(failure.pending, 1);
    assert(logs.some((line) => line.includes('TENANT_TRANSACTION_FAILED')));
    await db.$executeRaw`DROP TRIGGER reject_synthetic_purge ON tenants`;
    await db.$executeRaw`DROP FUNCTION reject_synthetic_purge()`;
    assert.equal((await restarted.runOnce()).purged, 1);

    process.env.APP_ENV = 'staging';
    await assert.rejects(restarted.runOnce(), /PRODUCTION_ONLY/);
    assert(logs.some((line) => line.includes('WRONG_ENVIRONMENT')));
    process.env.APP_ENV = 'production';
    assert.equal(JSON.stringify(logs).includes('Synthetic'), false);
    console.log('Production purge scheduler batches, dual worker, restart, metrics, and wrong environment passed.');
  } finally {
    await db.$disconnect();
    await db2.$disconnect();
  }
} finally {
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [databaseName]);
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
