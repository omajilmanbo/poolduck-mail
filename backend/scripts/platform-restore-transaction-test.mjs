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
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseName = `poolduck_restore_test_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
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
  const { LicenseService } = await import('../dist/license/license.service.js');
  const prisma = new PrismaService();
  const cleanupPrisma = new PrismaService();
  try {
    const service = new PlatformTenantsService(prisma, new PlatformAuditService(prisma));
    const license = new LicenseService(prisma);
    const platformAdmin = await prisma.platformAdmin.create({
      data: { email: 'restore-admin@example.local', passwordHash: 'synthetic-hash' },
    });
    const platformSession = await prisma.platformSession.create({
      data: {
        platformAdminId: platformAdmin.id,
        identityVersionSnapshot: platformAdmin.identityVersion,
        refreshTokenHash: 'b'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const actor = {
      platform_admin_id: platformAdmin.id,
      email_masked: 'r***n@example.local',
      identity_version: platformAdmin.identityVersion,
      session_id: platformSession.id,
    };
    const makeTenant = (tenantCode, subscriptionStatus = 'trial',
      endAt = new Date(Date.now() + 86_400_000), tenantStatus = 'active') =>
      prisma.tenant.create({
        data: {
          tenantCode, name: 'Synthetic Tenant', status: tenantStatus, locationLimit: 1,
          subscription: {
            create: {
              plan: 'manual', status: subscriptionStatus,
              startAt: new Date(Date.now() - 86_400_000 * 2), endAt,
            },
          },
        },
      });
    const markPending = async (tenantId, originalSubscriptionStatus, deadlineOffsetMs,
      originalTenantStatus = 'active') => {
      await prisma.$executeRaw`
        WITH stamp AS (
          SELECT date_trunc('milliseconds', clock_timestamp() AT TIME ZONE 'UTC')
            - INTERVAL '1 year' + ${deadlineOffsetMs} * INTERVAL '1 millisecond' AS value
        )
        UPDATE tenants AS t
        SET status = 'pending_delete', deleted_at = stamp.value,
            purge_after = stamp.value + INTERVAL '1 year',
            deleted_from_status = ${originalTenantStatus},
            deleted_from_subscription_status = ${originalSubscriptionStatus}
        FROM stamp WHERE t.id = ${tenantId}::uuid
      `;
      await prisma.subscription.update({
        where: { tenantId }, data: { status: 'suspended', version: { increment: 1 } },
      });
    };

    const first = await makeTenant('10PDRST001');
    const other = await makeTenant('10PDRST009');
    const manager = await prisma.user.create({
      data: {
        tenantId: first.id, email: 'manager@example.local',
        passwordHash: 'synthetic-hash', role: 'tenant_manager',
      },
    });
    const userSession = await prisma.session.create({
      data: {
        tenantId: first.id, userId: manager.id,
        refreshTokenHash: 'c'.repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const deletedAt = new Date();
    const purgeAfter = new Date(deletedAt.getTime() + 14 * 86_400_000);
    const location = await prisma.location.create({
      data: {
        tenantId: first.id, locationCode: '10PDA001', name: 'Synthetic Location',
        status: 'pending_delete', deletedAt, purgeAfter, deletedFromStatus: 'active',
      },
    });
    const person = await prisma.personMapping.create({
      data: {
        tenantId: first.id, locationId: location.id, personCode: '01K0ABC20001',
        scanCode: 'E01K0ABC20001', personName: 'Synthetic Person',
        email: 'person@example.local', status: 'pending_delete',
        deletedAt, purgeAfter, deletedFromStatus: 'active',
      },
    });
    const scan = await prisma.scanEvent.create({
      data: {
        tenantId: first.id, locationId: location.id, personMappingId: person.id,
        scanCode: person.scanCode, scanType: 'entry', action: 'entry',
        rawPayload: person.scanCode, receivedAt: new Date(),
      },
    });
    const mail = await prisma.mailJob.create({
      data: {
        tenantId: first.id, locationId: location.id, personMappingId: person.id,
        scanEventId: scan.id, tenantNameSnapshot: 'Synthetic Tenant',
        locationNameSnapshot: 'Synthetic Location', personNameSnapshot: 'Synthetic Person',
        personCodeSnapshot: person.personCode, toEmail: 'person@example.local',
        subject: 'Synthetic', body: 'Synthetic', templateKey: 'synthetic',
        status: 'failed', errorMessage: 'SUBSCRIPTION_NOT_SENDABLE',
      },
    });
    await markPending(first.id, 'trial', 3_600_000);
    const restored = await service.restoreTenant(actor, first.tenantCode);
    assert.equal(restored.status, 'active');
    assert.equal(restored.subscription.status, 'trial');
    assert.equal(restored.deleted_at, null);
    assert.equal(restored.purge_after, null);
    const afterRestore = await prisma.tenant.findUniqueOrThrow({
      where: { id: first.id }, include: { subscription: true },
    });
    assert.equal(afterRestore.deletedFromStatus, null);
    assert.equal(afterRestore.deletedFromSubscriptionStatus, null);
    assert.equal(afterRestore.subscription.version, 3);
    const otherAfterRestore = await prisma.tenant.findUniqueOrThrow({
      where: { id: other.id }, include: { subscription: true },
    });
    assert.equal(otherAfterRestore.status, 'active');
    assert.equal(otherAfterRestore.subscription.status, 'trial');
    assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: userSession.id } })).revokedAt, null);
    assert.equal((await prisma.location.findUniqueOrThrow({ where: { id: location.id } })).status, 'pending_delete');
    assert.equal((await prisma.personMapping.findUniqueOrThrow({ where: { id: person.id } })).status, 'pending_delete');
    assert.equal((await prisma.mailJob.findUniqueOrThrow({ where: { id: mail.id } })).status, 'failed');
    await assert.rejects(
      service.restoreTenant(actor, first.tenantCode),
      (error) => error.getResponse().code === 'PLATFORM_TENANT_NOT_PENDING_DELETE',
    );

    const expired = await makeTenant('10PDRST002', 'expired', new Date(Date.now() - 1000));
    await markPending(expired.id, 'expired', -1000);
    await assert.rejects(
      service.restoreTenant(actor, expired.tenantCode),
      (error) => error.getResponse().code === 'PLATFORM_TENANT_RESTORE_EXPIRED',
    );
    const expiredRow = await prisma.tenant.findUniqueOrThrow({ where: { id: expired.id } });
    assert.equal(expiredRow.status, 'pending_delete');

    const claimCleanup = (tenantId) => cleanupPrisma.$queryRaw`
      UPDATE tenants SET status = 'purged'
      WHERE id = ${tenantId}::uuid AND status = 'pending_delete'
        AND purge_after <= (clock_timestamp() AT TIME ZONE 'UTC')
      RETURNING id
    `;
    const futureRace = await makeTenant('10PDRST007');
    await markPending(futureRace.id, 'trial', 3_600_000);
    const futureResults = await Promise.allSettled([
      service.restoreTenant(actor, futureRace.tenantCode),
      claimCleanup(futureRace.id),
    ]);
    assert.equal(futureResults[0].status, 'fulfilled');
    assert.equal(futureResults[1].status, 'fulfilled');
    assert.equal(futureResults[1].value.length, 0);
    assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: futureRace.id } })).status,
      'active');

    const expiredRace = await makeTenant('10PDRST008');
    await markPending(expiredRace.id, 'trial', -1000);
    const expiredResults = await Promise.allSettled([
      service.restoreTenant(actor, expiredRace.tenantCode),
      claimCleanup(expiredRace.id),
    ]);
    assert.equal(expiredResults[0].status, 'rejected');
    assert.ok([
      'PLATFORM_TENANT_RESTORE_EXPIRED',
      'PLATFORM_TENANT_NOT_PENDING_DELETE',
    ].includes(expiredResults[0].reason.getResponse().code));
    assert.equal(expiredResults[1].status, 'fulfilled');
    assert.equal(expiredResults[1].value.length, 1);
    assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: expiredRace.id } })).status,
      'purged');

    const concurrent = await makeTenant('10PDRST003', 'suspended');
    await markPending(concurrent.id, 'suspended', 3_600_000);
    const results = await Promise.allSettled([
      service.restoreTenant(actor, concurrent.tenantCode),
      service.restoreTenant(actor, concurrent.tenantCode),
    ]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter((item) => item.status === 'rejected').length, 1);
    assert.equal(results.find((item) => item.status === 'rejected').reason.getResponse().code,
      'PLATFORM_TENANT_NOT_PENDING_DELETE');
    const concurrentRow = await prisma.tenant.findUniqueOrThrow({
      where: { id: concurrent.id }, include: { subscription: true },
    });
    assert.equal(concurrentRow.subscription.status, 'suspended');
    assert.equal(concurrentRow.subscription.version, 3);

    const suspendedTenant = await makeTenant('10PDRST010', 'suspended',
      new Date(Date.now() + 86_400_000), 'suspended');
    await markPending(suspendedTenant.id, 'suspended', 3_600_000, 'suspended');
    await service.restoreTenant(actor, suspendedTenant.tenantCode);
    assert.equal((await prisma.tenant.findUniqueOrThrow({ where: { id: suspendedTenant.id } })).status,
      'suspended');

    const overdueTrial = await makeTenant('10PDRST004', 'trial', new Date(Date.now() - 1000));
    await markPending(overdueTrial.id, 'trial', 3_600_000);
    await service.restoreTenant(actor, overdueTrial.tenantCode);
    assert.equal((await license.checkTenantLicense(overdueTrial.id)).can_send, false);

    const legacyActive = await makeTenant('10PDRST005', 'active', new Date(Date.now() - 1000));
    await markPending(legacyActive.id, 'active', 3_600_000);
    await service.restoreTenant(actor, legacyActive.tenantCode);
    assert.equal((await license.checkTenantLicense(legacyActive.id)).can_send, false);

    const rollback = await makeTenant('10PDRST006');
    await markPending(rollback.id, 'trial', 3_600_000);
    await prisma.$executeRaw`
      CREATE OR REPLACE FUNCTION reject_synthetic_restore() RETURNS trigger AS $$
      BEGIN
        IF OLD.status = 'suspended' AND NEW.status = 'trial' THEN
          RAISE EXCEPTION 'synthetic restore failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `;
    await prisma.$executeRaw`
      CREATE TRIGGER reject_synthetic_restore BEFORE UPDATE ON subscriptions
      FOR EACH ROW EXECUTE FUNCTION reject_synthetic_restore()
    `;
    await assert.rejects(service.restoreTenant(actor, rollback.tenantCode));
    const rolledBack = await prisma.tenant.findUniqueOrThrow({
      where: { id: rollback.id }, include: { subscription: true },
    });
    assert.equal(rolledBack.status, 'pending_delete');
    assert.notEqual(rolledBack.deletedAt, null);
    assert.equal(rolledBack.subscription.status, 'suspended');

    const boundary = await prisma.$queryRaw`
      SELECT
        TIMESTAMP '2029-02-28 12:00:00' > TIMESTAMP '2029-02-28 11:59:59.999' AS before,
        TIMESTAMP '2029-02-28 12:00:00' > TIMESTAMP '2029-02-28 12:00:00' AS exact,
        TIMESTAMP '2029-02-28 12:00:00' > TIMESTAMP '2029-02-28 12:00:00.001' AS after
    `;
    assert.deepEqual(boundary[0], { before: true, exact: false, after: false });
    const audits = await prisma.platformAuditLog.findMany({
      where: { action: 'platform.tenant.restore' },
      select: { metadataJson: true, resourceId: true, result: true },
    });
    assert.equal(JSON.stringify(audits).includes('manager@example.local'), false);
    assert.equal(JSON.stringify(audits).includes('person@example.local'), false);
    console.log('Production restore transaction, deadline, concurrency, independent state, and rollback passed.');
  } finally {
    await prisma.$disconnect();
    await cleanupPrisma.$disconnect();
  }
} finally {
  await admin.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [databaseName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  await admin.end();
}
