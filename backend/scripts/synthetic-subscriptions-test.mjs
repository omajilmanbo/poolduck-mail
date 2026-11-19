import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { LicenseService } from '../dist/license/license.service.js';

const source = process.env.DATABASE_URL;
assert(source, 'DATABASE_URL is required');
assert(['local', 'test'].includes(process.env.APP_ENV), 'Local/CI only');
const adminUrl = new URL(source);
assert(['localhost', '127.0.0.1'].includes(adminUrl.hostname), 'Local PostgreSQL only');
adminUrl.pathname = '/postgres';
const databaseName = `poolduck_seed_test_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;

const backend = fileURLToPath(new URL('..', import.meta.url));
const scripts = ['local-seed.mjs', 'staging-seed.mjs', 'platform-synthetic-seed.mjs'];
const expectedStatuses = {
  '10CA000001': 'active', '10CA000002': 'suspended',
  '5A6E000001': 'active', '5A6E000002': 'suspended', '5A6E000003': 'expired',
  '10PF000001': 'trial', '10PF000002': 'active',
  '10PF000003': 'suspended', '10PF000004': 'expired',
};
const oldEnd = Date.parse('2027-01-01T00:00:00.000Z');
const future = Date.parse('2040-02-29T12:00:00.000Z');
const dayMs = 86_400_000;
const admin = new Client({ connectionString: adminUrl.toString() });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl.toString() }) });

function runSeeds(now, cwd) {
  const clock = `data:text/javascript,${encodeURIComponent(`Date.now = () => ${now}`)}`;
  for (const script of scripts) {
    execFileSync(process.execPath, ['--import', clock, join(backend, 'scripts', script)], {
      cwd,
      env: {
        ...process.env,
        APP_ENV: 'test',
        NODE_ENV: 'test',
        DATABASE_URL: databaseUrl.toString(),
        PLATFORM_SYNTHETIC_SEED: 'true',
        PLATFORM_SYNTHETIC_EMAIL: 'platform@seed.example.local',
        PLATFORM_SYNTHETIC_PASSWORD: randomUUID(),
      },
    });
  }
}

async function snapshot(now, elapsed = false) {
  const actualNow = Date.now;
  Date.now = () => now;
  try {
    const licenseService = new LicenseService(prisma);
    const tenants = await prisma.tenant.findMany({
      where: { tenantCode: { in: Object.keys(expectedStatuses) } },
      select: { id: true, tenantCode: true, subscription: { omit: { updatedAt: true } } },
      orderBy: { tenantCode: 'asc' },
    });
    assert.equal(tenants.length, Object.keys(expectedStatuses).length);
    for (const tenant of tenants) {
      const status = expectedStatuses[tenant.tenantCode];
      assert.equal(tenant.subscription.status, status, tenant.tenantCode);
      const sendable = status === 'active' || status === 'trial';
      const license = await licenseService.checkTenantLicense(tenant.id);
      assert.equal(license.status, sendable && elapsed ? 'expired' : status, tenant.tenantCode);
      assert.equal(license.can_send, sendable && !elapsed, tenant.tenantCode);
    }
    return tenants;
  } finally {
    Date.now = actualNow;
  }
}

await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  try {
    execFileSync(process.execPath, [join(backend, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: backend,
      env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
    });
    // The seed entry points load .env relative to their working directory.
    const scratch = await mkdtemp(join(tmpdir(), 'poolduck-seed-'));
    const cwd = join(scratch, 'run');
    await mkdir(cwd);
    try {
      const witness = await prisma.tenant.create({
        data: {
          tenantCode: 'BEEFBEEFB0', name: 'Synthetic unrelated tenant', locationLimit: 1,
          subscription: { create: { plan: 'manual', status: 'active', startAt: new Date(0), endAt: new Date(oldEnd) } },
        },
        include: { subscription: true },
      });
      runSeeds(oldEnd - 1, cwd);
      const first = await snapshot(oldEnd - 1);
      const sendable = first.filter(({ subscription }) => ['active', 'trial'].includes(subscription.status));
      for (const { subscription } of first) {
        const expired = subscription.status === 'expired';
        assert.equal(subscription.startAt.toISOString(), expired ? '2025-01-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z');
        const expectedEnd = expired ? Date.parse('2025-12-31T23:59:59.000Z')
          : subscription.status === 'suspended' ? oldEnd : oldEnd - 1 + 365 * dayMs;
        assert.equal(subscription.endAt.getTime(), expectedEnd);
      }
      runSeeds(oldEnd, cwd);
      assert.deepEqual(await snapshot(oldEnd), first, 'A healthy period survives New Year and reseeding');

      // Reproduce the snapshots written by the old seed on the same fixture identities.
      const sendableIds = sendable.map(({ id }) => id);
      await prisma.subscription.updateMany({
        where: { tenantId: { in: sendableIds } },
        data: { endAt: new Date(oldEnd), version: 7 },
      });
      await snapshot(oldEnd - 1);
      const legacy = await snapshot(oldEnd, true);
      runSeeds(oldEnd, cwd);
      const renewed = await snapshot(oldEnd);
      assert.deepEqual(renewed, legacy.map((tenant) => sendableIds.includes(tenant.id)
        ? { ...tenant, subscription: { ...tenant.subscription, endAt: new Date(oldEnd + 365 * dayMs) } }
        : tenant));

      await snapshot(future, true);
      runSeeds(future, cwd);
      const later = await snapshot(future);
      assert.deepEqual(later, renewed.map((tenant) => sendableIds.includes(tenant.id)
        ? { ...tenant, subscription: { ...tenant.subscription, endAt: new Date(future + 365 * dayMs) } }
        : tenant));
      runSeeds(future + dayMs, cwd);
      assert.deepEqual(await snapshot(future + dayMs), later, 'A later rerun keeps healthy fixture fields');

      const rerunAt = future + dayMs;
      const threshold = rerunAt + 30 * dayMs;
      const [atThreshold, aboveThreshold] = sendableIds;
      await prisma.subscription.update({
        where: { tenantId: atThreshold }, data: { endAt: new Date(threshold) },
      });
      await prisma.subscription.update({
        where: { tenantId: aboveThreshold }, data: { endAt: new Date(threshold + 1) },
      });
      const shortWindows = await snapshot(rerunAt);
      runSeeds(rerunAt, cwd);
      assert.deepEqual(await snapshot(rerunAt), shortWindows.map((tenant) => tenant.id === atThreshold
        ? { ...tenant, subscription: { ...tenant.subscription, endAt: new Date(rerunAt + 365 * dayMs) } }
        : tenant));

      assert.deepEqual(await prisma.tenant.findUniqueOrThrow({
        where: { id: witness.id }, include: { subscription: true },
      }), witness);
      console.log('Synthetic subscription regression passed at 2026-12-31, 2027-01-01, and 2040-02-29 UTC.');
    } finally {
      await rmdir(cwd);
      await rmdir(scratch);
    }
  } finally {
    await prisma.$disconnect();
    await admin.query(`DROP DATABASE "${databaseName}"`);
  }
} finally {
  await admin.end();
}
