import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import argon2 from 'argon2';
import { Client } from 'pg';
import request from 'supertest';

const source = new URL(process.env.DATABASE_URL);
assert(['localhost', '127.0.0.1'].includes(source.hostname), 'Local PostgreSQL only');
assert(['local', 'test'].includes(process.env.APP_ENV), 'Local test environment required');
source.search = '';
source.pathname = '/postgres';
const adminDb = new Client({ connectionString: source.href });
const database = `poolduck_provision_${randomUUID().replaceAll('-', '')}`;
await adminDb.connect();
try {
  await adminDb.query(`CREATE DATABASE "${database}"`);
  try {
    source.pathname = `/${database}`;
    Object.assign(process.env, {
      DATABASE_URL: source.href, APP_ENV: 'test', NODE_ENV: 'test',
      MAIL_PROVIDER: 'mock', REAL_MAIL_SEND_ENABLED: 'false',
      JWT_SECRET: randomUUID(), PLATFORM_JWT_SECRET: randomUUID(),
      PLATFORM_REFRESH_TOKEN_SECRET: randomUUID(), PLATFORM_PROVISIONING_SECRET: randomUUID(),
    });
    execFileSync(process.execPath, [
      fileURLToPath(new URL('../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy',
    ], { cwd: fileURLToPath(new URL('../', import.meta.url)), stdio: 'pipe' });
    const db = new Client({ connectionString: source.href });
    await db.connect();
    try {
      await verify(db);
    } finally {
      await db.end();
    }
  } finally {
    await adminDb.query(`DROP DATABASE "${database}"`);
  }
} finally {
  await adminDb.end();
}

async function verify(db) {
  const { AppModule } = await import('../dist/app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  try {
    await app.listen(0, '127.0.0.1');
    const agent = request.agent(app.getHttpServer());
    const email = 'platform@provision.example.local';
    const password = randomUUID();
    const { rows: [actor] } = await db.query(
      'INSERT INTO platform_admins (email, password_hash, updated_at) VALUES ($1, $2, now()) RETURNING id',
      [email, await argon2.hash(password)],
    );
    await agent.post('/api/platform/auth/login').send({ email, password }).expect(201);
    const body = {
      name: 'Synthetic Provisioning', manager_email: 'manager@provision.example.local',
      subscription_status: 'active', start_at: new Date(Date.now() - 60_000).toISOString(),
      end_at: new Date(Date.now() + 86_400_000).toISOString(), location_limit: 3,
    };
    const key = randomUUID();
    const create = (id, idempotencyKey = key) => agent.post('/api/platform/tenants')
      .set('X-Request-Id', id).set('Idempotency-Key', idempotencyKey).send(body);
    const audits = async (id) => (await db.query(`
      SELECT platform_admin_id, target_tenant_id, resource_type, resource_id, result, metadata_json
      FROM platform_audit_logs WHERE action = 'platform.tenant.create' AND request_id = $1
    `, [id])).rows;
    const checkCounts = async (business, successes, failures) => {
      const { rows: [counts] } = await db.query(`
        SELECT (SELECT count(*)::int FROM tenants) AS tenants,
          (SELECT count(*)::int FROM subscriptions) AS subscriptions,
          (SELECT count(*)::int FROM users) AS users,
          (SELECT count(*)::int FROM platform_tenant_idempotency) AS keys,
          (SELECT count(*)::int FROM mail_jobs) AS jobs,
          (SELECT count(*)::int FROM mail_delivery_attempts) AS deliveries,
          count(*) FILTER (WHERE result = 'success')::int AS successes,
          count(*) FILTER (WHERE result = 'failure')::int AS failures
        FROM platform_audit_logs WHERE action = 'platform.tenant.create'
      `);
      assert.deepEqual(counts, {
        tenants: business, subscriptions: business, users: business, keys: business,
        jobs: 0, deliveries: 0, successes, failures,
      });
    };

    // The trigger sees all four inserts. The sequence survives rollback and proves the injection fired.
    await db.query(`
      CREATE SEQUENCE rollback_probe;
      CREATE FUNCTION reject_provision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT FROM tenants WHERE id = NEW.tenant_id)
          AND EXISTS (SELECT FROM subscriptions WHERE tenant_id = NEW.tenant_id)
          AND EXISTS (SELECT FROM users WHERE tenant_id = NEW.tenant_id AND role = 'tenant_manager')
          AND EXISTS (SELECT FROM platform_tenant_idempotency WHERE id = NEW.id) THEN
          PERFORM nextval('rollback_probe');
        END IF;
        RAISE EXCEPTION 'synthetic transaction failure';
      END $$;
      CREATE TRIGGER reject_provision AFTER INSERT ON platform_tenant_idempotency
        FOR EACH ROW EXECUTE FUNCTION reject_provision();
    `);
    const genericError = { statusCode: 500, message: 'Internal server error' };
    await create('pg-rollback').expect(500, genericError);
    assert.deepEqual((await db.query('SELECT is_called, last_value::int FROM rollback_probe')).rows,
      [{ is_called: true, last_value: 1 }]);
    assert.deepEqual(await audits('pg-rollback'), [{
      platform_admin_id: actor.id, target_tenant_id: null, resource_type: 'tenant',
      resource_id: 'unknown', result: 'failure', metadata_json: { reason: 'TRANSACTION_ROLLED_BACK' },
    }]);
    await checkCounts(0, 0, 1);

    await db.query(`ALTER TABLE platform_audit_logs
      ADD CHECK (request_id NOT IN ('pg-no-audit', 'pg-replay-no-audit'))`);
    await create('pg-no-audit').expect(500, genericError);
    assert.deepEqual(await audits('pg-no-audit'), []);
    assert.equal((await db.query('SELECT last_value::int FROM rollback_probe')).rows[0].last_value, 2);
    await checkCounts(0, 0, 1);
    await db.query('DROP TRIGGER reject_provision ON platform_tenant_idempotency');

    await db.query(`
      CREATE CONSTRAINT TRIGGER reject_at_commit AFTER INSERT ON platform_tenant_idempotency
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION reject_provision()
    `);
    await create('pg-rejected-commit').expect(500, genericError);
    assert.deepEqual((await audits('pg-rejected-commit')).map((row) => row.metadata_json),
      [{ reason: 'TRANSACTION_ROLLED_BACK' }]);
    assert.equal((await db.query('SELECT last_value::int FROM rollback_probe')).rows[0].last_value, 3);
    await checkCounts(0, 0, 2);
    await db.query('DROP TRIGGER reject_at_commit ON platform_tenant_idempotency');

    const ids = ['pg-retry-a', 'pg-retry-b'];
    const replies = await Promise.all(ids.map((id) => create(id).expect(201)));
    const [first, second] = replies.map((reply) => reply.body);
    assert.deepEqual([first.idempotency_replayed, second.idempotency_replayed].sort(), [false, true]);
    assert.ok(first.temporary_password && first.temporary_password === second.temporary_password);
    assert.equal(first.tenant_code, second.tenant_code);
    const { rows: [tenant] } = await db.query('SELECT id FROM tenants WHERE tenant_code = $1', [first.tenant_code]);
    for (const [i, id] of ids.entries()) {
      assert.deepEqual(await audits(id), [{
        platform_admin_id: actor.id, target_tenant_id: tenant.id, resource_type: 'tenant',
        resource_id: tenant.id, result: 'success',
        metadata_json: { replayed: replies[i].body.idempotency_replayed, tenant_code: first.tenant_code, location_limit: 3 },
      }]);
    }
    await checkCounts(1, 2, 2);

    const replay = await create('pg-replay-no-audit').expect(201);
    assert.equal(replay.body.idempotency_replayed, true);
    assert.equal(replay.body.tenant_code, first.tenant_code);
    assert.ok(replay.body.temporary_password === first.temporary_password);
    assert.deepEqual(await audits('pg-replay-no-audit'), []);
    await checkCounts(1, 2, 2);

    // Force just the first attempt for a fresh key to hit the existing tenant_code unique constraint.
    await db.query(`
      CREATE SEQUENCE collision_probe;
      CREATE FUNCTION collide_once() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF nextval('collision_probe') = 1 THEN SELECT tenant_code INTO NEW.tenant_code FROM tenants LIMIT 1; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER collide_once BEFORE INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION collide_once();
    `);
    const fresh = await create('pg-auto-retry', randomUUID()).expect(201);
    assert.equal(fresh.body.idempotency_replayed, false);
    assert.equal((await db.query('SELECT last_value::int FROM collision_probe')).rows[0].last_value, 2);
    assert.deepEqual((await audits('pg-auto-retry')).map((row) => row.result), ['success']);
    await checkCounts(2, 3, 2);
    console.log('Verified callback and commit rollbacks, unwritable audit, concurrent same-key recovery and tenant-code retry.');
  } finally {
    await app.close();
  }
}
