import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import argon2 from 'argon2';

const source = process.env.DATABASE_URL;
assert(source, 'DATABASE_URL is required');
assert(['local', 'test'].includes(process.env.APP_ENV), 'Local/CI only');
const sourceUrl = new URL(source);
assert(['localhost', '127.0.0.1'].includes(sourceUrl.hostname), 'Local PostgreSQL only');
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseName = `poolduck_delete_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const admin = new Client({ connectionString: adminUrl.toString() });

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  const testUrl = new URL(sourceUrl);
  testUrl.pathname = `/${databaseName}`;
  execFileSync(process.execPath, [
    path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js'),
    'migrate', 'deploy',
  ], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = testUrl.toString();
  process.env.APP_ENV = 'production';
  const { PrismaService } = await import('../dist/prisma.service.js');
  const { PlatformAuditService } = await import('../dist/platform/platform-audit.service.js');
  const { PlatformTenantsService } = await import('../dist/platform/platform-tenants.service.js');
  const prisma = new PrismaService();
  try {
    const service = new PlatformTenantsService(prisma, new PlatformAuditService(prisma));
    const password = 'Synthetic-Delete-Password-123!';
    const platformAdmin = await prisma.platformAdmin.create({
      data: { email: 'delete-admin@example.local', passwordHash: await argon2.hash(password) },
    });
    const session = await prisma.platformSession.create({
      data: {
        platformAdminId: platformAdmin.id,
        identityVersionSnapshot: platformAdmin.identityVersion,
        refreshTokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const actor = {
      platform_admin_id: platformAdmin.id,
      email_masked: 'd***n@example.local',
      identity_version: platformAdmin.identityVersion,
      session_id: session.id,
    };
    const makeTenant = (tenantCode) => prisma.tenant.create({
      data: {
        tenantCode,
        name: 'Synthetic Tenant',
        locationLimit: 1,
        subscription: {
          create: {
            plan: 'manual', status: 'active',
            startAt: new Date(Date.now() - 60_000),
            endAt: new Date(Date.now() + 86_400_000),
          },
        },
      },
    });

    const first = await makeTenant('10PDAEE001');
    const concurrent = await Promise.all([
      service.deleteTenant(actor, first.tenantCode, { password }),
      service.deleteTenant(actor, first.tenantCode, { password }),
    ]);
    assert.equal(concurrent.filter((item) => item.idempotency_replayed).length, 1);
    assert.equal(concurrent[0].deleted_at, concurrent[1].deleted_at);
    assert.equal(concurrent[0].purge_after, concurrent[1].purge_after);
    const stored = await prisma.tenant.findUniqueOrThrow({
      where: { id: first.id }, include: { subscription: true },
    });
    assert.equal(stored.status, 'pending_delete');
    assert.equal(stored.deletedFromStatus, 'active');
    assert.equal(stored.deletedFromSubscriptionStatus, 'active');
    assert.equal(stored.subscription.status, 'suspended');
    assert.equal(stored.subscription.version, 2);
    const dbDeadline = await prisma.$queryRaw`
      SELECT purge_after = deleted_at + INTERVAL '1 year' AS valid
      FROM tenants WHERE id = ${first.id}::uuid
    `;
    assert.equal(dbDeadline[0].valid, true);

    const second = await makeTenant('10PDAEE002');
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: second.id } });
    const update = service.updateSubscription(actor, second.tenantCode, {
      status: 'active',
      start_at: subscription.startAt.toISOString(),
      end_at: subscription.endAt.toISOString(),
      version: subscription.version,
    });
    const deletion = service.deleteTenant(actor, second.tenantCode, { password });
    const competing = await Promise.allSettled([update, deletion]);
    assert.equal(competing[1].status, 'fulfilled');
    if (competing[0].status === 'rejected') {
      assert.equal(competing[0].reason.getResponse().code, 'PLATFORM_TENANT_PENDING_DELETE');
    }
    const afterRace = await prisma.tenant.findUniqueOrThrow({
      where: { id: second.id }, include: { subscription: true },
    });
    assert.equal(afterRace.status, 'pending_delete');
    assert.equal(afterRace.subscription.status, 'suspended');

    const third = await makeTenant('10PDAEE003');
    await prisma.$executeRaw`
      CREATE OR REPLACE FUNCTION reject_synthetic_suspend() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'suspended' THEN
          RAISE EXCEPTION 'synthetic suspend failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;
    await prisma.$executeRaw`
      CREATE TRIGGER reject_synthetic_suspend BEFORE UPDATE ON subscriptions
      FOR EACH ROW EXECUTE FUNCTION reject_synthetic_suspend()
    `;
    await assert.rejects(service.deleteTenant(actor, third.tenantCode, { password }));
    const afterFailure = await prisma.tenant.findUniqueOrThrow({
      where: { id: third.id }, include: { subscription: true },
    });
    assert.equal(afterFailure.status, 'active');
    assert.equal(afterFailure.deletedAt, null);
    assert.equal(afterFailure.subscription.status, 'active');
    console.log('Production delete transaction, concurrent replay, subscription race, and rollback passed.');
  } finally {
    await prisma.$disconnect();
  }
} finally {
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
