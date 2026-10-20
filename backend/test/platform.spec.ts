import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { PlatformTenantsService } from '../src/platform/platform-tenants.service';

describe('Platform control plane', () => {
  let app: INestApplication;
  let passwordHash: string;
  let storedSession: Record<string, unknown> | null;
  let sessionAdminStatus: string;
  const adminId = 'a1000000-0000-4000-8000-000000000001';
  const sessionId = 'a2000000-0000-4000-8000-000000000001';
  const tenantId = 'a3000000-0000-4000-8000-000000000001';
  const tenantCode = '10PFABC001';
  const password = 'PlatformTestPassword123!';
  const now = new Date('2026-07-29T00:00:00.000Z');
  const tenantRow = {
    id: tenantId,
    tenantCode,
    name: 'Synthetic Tenant',
    status: 'active',
    locationLimit: 1,
    platformVersion: 1,
    createdAt: now,
    subscription: {
      plan: 'manual',
      status: 'trial',
      startAt: now,
      endAt: new Date('2026-08-29T00:00:00.000Z'),
      version: 1,
    },
    users: [{ email: 'manager@example.local', status: 'active' }],
    _count: { locations: 0 },
    platformAuditLogs: [],
  };
  let prisma: any;
  const originalAppEnv = process.env.APP_ENV;

  beforeAll(async () => {
    process.env.PLATFORM_JWT_SECRET = 'platform-test-access-secret';
    process.env.PLATFORM_REFRESH_TOKEN_SECRET = 'platform-test-refresh-secret';
    process.env.PLATFORM_PROVISIONING_SECRET =
      'platform-test-provisioning-secret-with-32-chars';
    passwordHash = await argon2.hash(password);
  });

  beforeEach(async () => {
    storedSession = null;
    sessionAdminStatus = 'active';
    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (input: unknown) => {
        if (typeof input === 'function') return input(prisma);
        return Promise.all(input as Promise<unknown>[]);
      }),
      user: { findFirst: jest.fn() },
      session: { updateMany: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      platformAuditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue({
          id: adminId,
          email: 'root@example.local',
          passwordHash,
          status: 'active',
          identityVersion: 1,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      platformSession: {
        create: jest.fn(async ({ data }: any) => {
          storedSession = data;
          return data;
        }),
        findUnique: jest.fn(async () =>
          storedSession
            ? {
                ...storedSession,
                platformAdmin: {
                  id: adminId,
                  email: 'root@example.local',
                  status: sessionAdminStatus,
                  identityVersion: 1,
                },
              }
            : null,
        ),
        update: jest.fn(async ({ data }: any) => {
          storedSession = { ...storedSession, ...data };
          return storedSession;
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      platformTenantIdempotency: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(undefined),
      },
      tenant: {
        findMany: jest.fn().mockResolvedValue([tenantRow]),
        findUnique: jest.fn().mockResolvedValue(tenantRow),
        create: jest.fn().mockResolvedValue(tenantRow),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscription: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      location: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());
  afterAll(() => {
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
  });

  function mockDeletionQueries(status = 'active', subscriptionStatus = 'trial') {
    const deletedAt = new Date('2028-02-29T12:00:00.000Z');
    const purgeAfter = new Date('2029-02-28T12:00:00.000Z');
    prisma.$queryRaw = jest.fn(async (query: { strings: string[] }) => {
      const sql = query.strings.join(' ');
      if (sql.includes('FROM platform_sessions')) return [{ password_hash: passwordHash }];
      if (sql.includes('FROM tenants')) return [{
        id: tenantId, status,
        deleted_at: status === 'pending_delete' ? deletedAt : null,
        purge_after: status === 'pending_delete' ? purgeAfter : null,
      }];
      if (sql.includes('UPDATE tenants')) return [{ deleted_at: deletedAt, purge_after: purgeAfter }];
      throw new Error('Unexpected SQL');
    });
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'a4000000-0000-4000-8000-000000000001',
      tenantId,
      status: subscriptionStatus,
      startAt: new Date('2028-01-01T00:00:00.000Z'),
      endAt: new Date('2028-12-31T00:00:00.000Z'),
      version: 1,
    });
    prisma.subscription.update = jest.fn().mockResolvedValue({});
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
  }

  function mockRestoreQueries(options: {
    tenantStatus?: string;
    originalTenantStatus?: string;
    originalSubscriptionStatus?: string;
    expired?: boolean;
    subscriptionMismatch?: boolean;
    sessionInvalid?: boolean;
  } = {}) {
    const tenantStatus = options.tenantStatus ?? 'pending_delete';
    const originalTenantStatus = options.originalTenantStatus ?? 'active';
    const originalSubscriptionStatus = options.originalSubscriptionStatus ?? 'trial';
    prisma.$queryRaw = jest.fn(async (query: { strings: string[] }) => {
      const sql = query.strings.join(' ');
      if (sql.includes('FROM platform_sessions')) {
        return options.sessionInvalid ? [] : [{ id: sessionId }];
      }
      if (sql.includes('FROM tenants')) return [{
        status: tenantStatus,
        deleted_from_status: originalTenantStatus,
        deleted_from_subscription_status: originalSubscriptionStatus,
      }];
      if (sql.includes('UPDATE tenants')) {
        return options.expired ? [] : [{ id: tenantId }];
      }
      throw new Error('Unexpected SQL');
    });
    prisma.subscription.updateMany.mockResolvedValue({
      count: options.subscriptionMismatch ? 0 : 1,
    });
    prisma.tenant.findUnique.mockImplementation(async ({ where }: any) =>
      where.id ? {
        ...tenantRow,
        status: originalTenantStatus,
        deletedAt: null,
        purgeAfter: null,
        subscription: {
          ...tenantRow.subscription,
          status: originalSubscriptionStatus,
          version: 3,
        },
      } : tenantRow,
    );
  }

  it.each(['trial', 'active', 'expired', 'suspended'])(
    'restores the previous %s subscription without changing its term',
    async (originalSubscriptionStatus) => {
      process.env.APP_ENV = 'production';
      mockRestoreQueries({ originalSubscriptionStatus });
      const endpoint = `/api/platform/tenants/${tenantCode}/restore`;
      await request(app.getHttpServer()).post(endpoint).send({}).expect(401);
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/platform/auth/login')
        .send({ email: 'root@example.local', password }).expect(201);
      const response = await agent.post(endpoint).send({}).expect(201);
      expect(response.body).toMatchObject({
        tenant_code: tenantCode,
        status: 'active',
        deleted_at: null,
        purge_after: null,
        subscription: { status: originalSubscriptionStatus, version: 3 },
      });
      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { tenantId, status: 'suspended' },
        data: {
          status: originalSubscriptionStatus,
          version: { increment: 1 },
        },
      });
      expect(prisma.subscription.updateMany.mock.calls[0][0].data).not.toHaveProperty('endAt');
      const sql = (prisma.$queryRaw.mock.calls as [any][])
        .map(([query]) => query.strings.join(' ')).join(' ');
      expect(sql).toContain('FOR UPDATE');
      expect(sql).toContain("purge_after > (clock_timestamp() AT TIME ZONE 'UTC')");
      expect(JSON.stringify(prisma.platformAuditLog.create.mock.calls)).not.toContain('manager@example.local');
    },
  );

  it('rejects expired, repeated, and inconsistent restore requests', async () => {
    process.env.APP_ENV = 'production';
    mockRestoreQueries({ expired: true });
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password }).expect(201);
    const endpoint = `/api/platform/tenants/${tenantCode}/restore`;
    const expired = await agent.post(endpoint).send({}).expect(409);
    expect(expired.body.code).toBe('PLATFORM_TENANT_RESTORE_EXPIRED');
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();

    mockRestoreQueries({ tenantStatus: 'active' });
    const repeated = await agent.post(endpoint).send({}).expect(409);
    expect(repeated.body.code).toBe('PLATFORM_TENANT_NOT_PENDING_DELETE');

    mockRestoreQueries({ subscriptionMismatch: true });
    const inconsistent = await agent.post(endpoint).send({}).expect(409);
    expect(inconsistent.body.code).toBe('PLATFORM_TENANT_RESTORE_STATE_INVALID');
  });

  it('requires platform identity and Production for restoration', async () => {
    process.env.APP_ENV = 'production';
    mockRestoreQueries();
    const endpoint = `/api/platform/tenants/${tenantCode}/restore`;
    const tenantJwt = new JwtService({ secret: process.env.JWT_SECRET });
    await request(app.getHttpServer()).post(endpoint)
      .set('Authorization', `Bearer ${tenantJwt.sign({ sub: 'user-1', tenant_id: tenantId })}`)
      .send({}).expect(401);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password }).expect(201);
    await agent.post(endpoint).send({ environment: 'production' }).expect(400);
    await agent.post(endpoint).send([]).expect(400);
    prisma.tenant.findUnique.mockImplementation(async ({ where }: any) =>
      where.tenantCode === 'UNKNOWN' ? null : tenantRow,
    );
    await agent.post('/api/platform/tenants/UNKNOWN/restore').send({}).expect(404);

    mockRestoreQueries({ sessionInvalid: true });
    await agent.post(endpoint).send({}).expect(403);
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
    storedSession = { ...storedSession, revokedAt: new Date() };
    await agent.post(endpoint).send({}).expect(401);
    storedSession = { ...storedSession, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) };
    sessionAdminStatus = 'inactive';
    await agent.post(endpoint).send({}).expect(401);
    sessionAdminStatus = 'active';
    process.env.APP_ENV = 'staging';
    mockRestoreQueries();
    await agent.post(endpoint).send({}).expect(503);
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('deletes only after platform authentication and password confirmation', async () => {
    process.env.APP_ENV = 'production';
    mockDeletionQueries();
    const endpoint = `/api/platform/tenants/${tenantCode}/delete`;
    await request(app.getHttpServer()).post(endpoint).send({ password }).expect(401);
    const tenantJwt = new JwtService({ secret: process.env.JWT_SECRET });
    await request(app.getHttpServer()).post(endpoint)
      .set('Authorization', `Bearer ${tenantJwt.sign({ sub: 'user-1', tenant_id: tenantId })}`)
      .send({ password }).expect(401);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password }).expect(201);
    await agent.post(endpoint).send({ password: 'incorrect' }).expect(403);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    await agent.post(endpoint).send({}).expect(400);
    await agent.post(endpoint).send({ password, environment: 'production' }).expect(400);
    prisma.tenant.findUnique.mockImplementation(async ({ where }: any) =>
      where.tenantCode === 'UNKNOWN' ? null : tenantRow,
    );
    await agent.post('/api/platform/tenants/UNKNOWN/delete').send({ password }).expect(404);
    const response = await agent.post(endpoint).send({ password }).expect(201);
    expect(response.body).toMatchObject({
      tenant_code: tenantCode, status: 'pending_delete',
      deleted_at: '2028-02-29T12:00:00.000Z',
      purge_after: '2029-02-28T12:00:00.000Z',
      idempotency_replayed: false,
    });
    expect(prisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'a4000000-0000-4000-8000-000000000001' },
      data: { status: 'suspended', version: { increment: 1 } },
    });
    const sql = (prisma.$queryRaw.mock.calls as [any][])
      .map(([query]) => query.strings.join(' ')).join(' ');
    expect(sql).toContain("INTERVAL '1 year'");
    expect(sql).toContain('FOR UPDATE');
    expect(JSON.stringify(prisma.platformAuditLog.create.mock.calls)).not.toContain(password);
    expect(JSON.stringify(prisma.platformAuditLog.create.mock.calls)).not.toContain('root@example.local');
  });

  it.each(['trial', 'expired', 'suspended'])(
    'snapshots the previous %s subscription state',
    async (subscriptionStatus) => {
      process.env.APP_ENV = 'production';
      mockDeletionQueries('active', subscriptionStatus);
      const agent = request.agent(app.getHttpServer());
      await agent.post('/api/platform/auth/login')
        .send({ email: 'root@example.local', password }).expect(201);
      await agent.post(`/api/platform/tenants/${tenantCode}/delete`)
        .send({ password }).expect(201);
      const updateQuery = (prisma.$queryRaw.mock.calls as [any][])
        .map(([query]) => query)
        .find((query) => query.strings.join(' ').includes('UPDATE tenants'));
      expect(updateQuery.values).toContain(subscriptionStatus);
      expect(prisma.subscription.update).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects an active subscription without starting tenant deletion', async () => {
    process.env.APP_ENV = 'production';
    mockDeletionQueries('active', 'active');
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password }).expect(201);
    const response = await agent.post(`/api/platform/tenants/${tenantCode}/delete`)
      .send({ password }).expect(409);
    expect(response.body.code).toBe('PLATFORM_TENANT_ACTIVE_SUBSCRIPTION');
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect((prisma.$queryRaw.mock.calls as [any][])
      .filter(([query]) => query.strings.join(' ').includes('UPDATE tenants'))).toHaveLength(0);
    const audit = prisma.platformAuditLog.create.mock.calls.at(-1)[0].data;
    expect(audit.result).toBe('failure');
    expect(audit.metadataJson.reason).toBe('PLATFORM_TENANT_ACTIVE_SUBSCRIPTION');
  });

  it('rejects revoked sessions and fails closed outside Production', async () => {
    process.env.APP_ENV = 'production';
    mockDeletionQueries();
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password }).expect(201);
    const endpoint = `/api/platform/tenants/${tenantCode}/delete`;
    const forgedPlatformToken = new JwtService({
      secret: process.env.PLATFORM_JWT_SECRET,
    }).sign({
      sub: 'a1000000-0000-4000-8000-000000000099',
      platform_admin_id: 'a1000000-0000-4000-8000-000000000099',
      identity_version: 1,
      session_id: storedSession?.id,
      token_type: 'access',
    }, { audience: 'poolduck-platform' });
    await request(app.getHttpServer()).post(endpoint)
      .set('Authorization', `Bearer ${forgedPlatformToken}`)
      .send({ password }).expect(401);
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await agent.post(endpoint).send({ password }).expect(403);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    storedSession = { ...storedSession, revokedAt: new Date() };
    await agent.post(endpoint).send({ password }).expect(401);
    storedSession = { ...storedSession, revokedAt: null, expiresAt: new Date(0) };
    await agent.post(endpoint).send({ password }).expect(401);
    storedSession = { ...storedSession, expiresAt: new Date(Date.now() + 60000) };
    sessionAdminStatus = 'inactive';
    await agent.post(endpoint).send({ password }).expect(401);
    sessionAdminStatus = 'active';
    process.env.APP_ENV = 'staging';
    await agent.post(endpoint).send({ password }).expect(503);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });

  it('does not report deletion success when the subscription write fails', async () => {
    process.env.APP_ENV = 'production';
    mockDeletionQueries();
    prisma.subscription.update.mockRejectedValue(new Error('synthetic transaction failure'));
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password }).expect(201);
    await agent.post(`/api/platform/tenants/${tenantCode}/delete`)
      .send({ password }).expect(500);
    const calls = prisma.platformAuditLog.create.mock.calls.map(([input]: [any]) => input.data);
    expect(calls.at(-1).result).toBe('failure');
    expect(calls.at(-1).metadataJson.reason).toBe('TRANSACTION_FAILED');
  });

  it('records a fresh staging cleanup start when retrying an inaccessible tenant', async () => {
    process.env.APP_ENV = 'staging';
    process.env.STAGING_TENANT_DELETE_ENABLED = 'true';
    mockDeletionQueries('staging_deleting', 'suspended');
    const service = app.get(PlatformTenantsService);
    jest.spyOn(service as any, 'purgeStagingTenant').mockResolvedValue(true);
    const agent = request.agent(app.getHttpServer());
    try {
      await agent.post('/api/platform/auth/login')
        .send({ email: 'root@example.local', password }).expect(201);
      const response = await agent.post(`/api/platform/tenants/${tenantCode}/delete`)
        .send({ password }).expect(201);
      expect(response.body.status).toBe('deleted');
      expect(prisma.subscription.update).not.toHaveBeenCalled();
      expect(prisma.platformAuditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        targetTenantId: tenantId,
        action: 'platform.tenant.staging_delete_started',
        metadataJson: { environment: 'staging', reason: 'CLEANUP_RETRY_PENDING' },
      }) });
    } finally {
      delete process.env.STAGING_TENANT_DELETE_ENABLED;
    }
  });

  it('replays pending deletion without changing the deadline or subscription', async () => {
    process.env.APP_ENV = 'production';
    mockDeletionQueries('pending_delete');
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password }).expect(201);
    const response = await agent.post(`/api/platform/tenants/${tenantCode}/delete`)
      .send({ password }).expect(201);
    expect(response.body.idempotency_replayed).toBe(true);
    expect(prisma.subscription.update).not.toHaveBeenCalled();
    expect((prisma.$queryRaw.mock.calls as [any][])
      .filter(([query]) => query.strings.join(' ').includes('UPDATE tenants'))).toHaveLength(0);
  });

  it('cannot reactivate subscription once deletion owns the tenant lock', async () => {
    mockDeletionQueries('pending_delete');
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password }).expect(201);
    const response = await agent.patch(`/api/platform/tenants/${tenantCode}/subscription`)
      .send({
        status: 'active',
        start_at: new Date(Date.now() - 1000).toISOString(),
        end_at: new Date(Date.now() + 86400000).toISOString(),
        version: 1,
      }).expect(409);
    expect(response.body.code).toBe('PLATFORM_TENANT_PENDING_DELETE');
    expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
  });

  it('uses independent cookies, finite session and masked identity', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await agent
      .post('/api/platform/auth/login')
      .send({ email: 'ROOT@EXAMPLE.LOCAL', password })
      .expect(201);
    expect(login.body.admin).toMatchObject({
      platform_admin_id: adminId,
      email_masked: 'r***t@example.local',
    });
    expect(String(login.headers['set-cookie'])).toContain(
      'poolduck_platform_access=',
    );
    expect(String(login.headers['set-cookie'])).toContain(
      'poolduck_platform_refresh=',
    );
    await agent.get('/api/platform/auth/me').expect(200);
    await agent.post('/api/platform/auth/refresh').expect(201);
    expect(prisma.platformSession.update).toHaveBeenCalled();
    await agent.post('/api/platform/auth/logout').expect(201);
    expect(prisma.platformSession.updateMany).toHaveBeenCalled();
  });

  it('returns one generic failure for missing identity and wrong password', async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    const missing = await request(app.getHttpServer())
      .post('/api/platform/auth/login')
      .send({ email: 'missing@example.local', password })
      .expect(401);
    expect(missing.body.code).toBe('PLATFORM_LOGIN_FAILED');
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: adminId,
      email: 'root@example.local',
      passwordHash,
      status: 'active',
      identityVersion: 1,
    });
    const wrong = await request(app.getHttpServer())
      .post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password: 'WrongPassword123!' })
      .expect(401);
    expect(wrong.body).toMatchObject({
      code: 'PLATFORM_LOGIN_FAILED',
      message: '登录失败',
    });
    expect(JSON.stringify(prisma.platformAuditLog.create.mock.calls)).not.toContain(
      'missing@example.local',
    );
  });

  it('rejects tenant and platform tokens in the opposite API audience', async () => {
    const tenantJwt = new JwtService({ secret: process.env.JWT_SECRET });
    const tenantToken = tenantJwt.sign({
      sub: 'user-1',
      user_id: 'user-1',
      tenant_id: tenantId,
      role: 'tenant_manager',
    });
    await request(app.getHttpServer())
      .get('/api/platform/tenants')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/platform/auth/mail-mode')
      .set('Authorization', `Bearer ${tenantToken}`)
      .expect(401);

    const platformJwt = new JwtService({
      secret: process.env.PLATFORM_JWT_SECRET,
    });
    const platformToken = platformJwt.sign(
      {
        sub: adminId,
        platform_admin_id: adminId,
        identity_version: 1,
        session_id: sessionId,
        token_type: 'access',
      },
      { audience: 'poolduck-platform' },
    );
    await request(app.getHttpServer())
      .get('/api/locations')
      .set('Authorization', `Bearer ${platformToken}`)
      .expect(401);
  });

  it('exposes only the effective mail mode to an authenticated platform admin', async () => {
    await request(app.getHttpServer())
      .get('/api/platform/auth/mail-mode')
      .expect(401);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password })
      .expect(201);
    const response = await agent.get('/api/platform/auth/mail-mode').expect(200);
    expect(response.body).toEqual({ mode: 'mock' });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('returns the trusted deletion environment only to platform admins', async () => {
    await request(app.getHttpServer()).get('/api/platform/auth/environment').expect(401);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password }).expect(201);
    process.env.APP_ENV = 'production';
    const production = await agent.get('/api/platform/auth/environment').expect(200);
    expect(production.body).toEqual({ environment: 'production', deletion_enabled: true });
    process.env.APP_ENV = 'staging';
    process.env.STAGING_TENANT_DELETE_ENABLED = 'false';
    const staging = await agent.get('/api/platform/auth/environment').expect(200);
    expect(staging.body).toEqual({ environment: 'staging', deletion_enabled: false });
    expect(staging.headers['cache-control']).toBe('no-store');
    process.env.STAGING_TENANT_DELETE_ENABLED = 'true';
    const enabled = await agent.get('/api/platform/auth/environment').expect(200);
    expect(enabled.body).toEqual({ environment: 'staging', deletion_enabled: true });
    delete process.env.STAGING_TENANT_DELETE_ENABLED;
  });

  it('lists only minimal summaries and atomically creates an idempotent tenant', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/platform/auth/login')
      .send({ email: 'root@example.local', password })
      .expect(201);
    const list = await agent.get('/api/platform/tenants').expect(200);
    expect(list.body[0]).toMatchObject({
      tenant_code: tenantCode,
      location_limit: 1,
      location_count: 0,
      manager: { email_masked: 'm***r@example.local' },
    });
    expect(JSON.stringify(list.body)).not.toContain('password');
    expect(JSON.stringify(list.body)).not.toContain('manager@example.local');
    expect(list.body[0]).not.toHaveProperty('tenant_id');

    const startAt = new Date(Date.now() - 60_000).toISOString();
    const endAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString();
    const body = {
      name: 'Synthetic Tenant',
      manager_email: 'manager@example.local',
      subscription_status: 'trial',
      start_at: startAt,
      end_at: endAt,
      location_limit: 1,
    };
    const created = await agent
      .post('/api/platform/tenants')
      .set('Idempotency-Key', 'create-synthetic-1')
      .send(body)
      .expect(201);
    expect(created.body.temporary_password).toHaveLength(28);
    expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
    expect(
      JSON.stringify(prisma.platformAuditLog.create.mock.calls),
    ).not.toContain(created.body.temporary_password);

    prisma.platformTenantIdempotency.findUnique.mockResolvedValue({
      requestFingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            name: body.name,
            manager_email: body.manager_email,
            subscription_status: body.subscription_status,
            start_at: body.start_at,
            end_at: body.end_at,
            location_limit: body.location_limit,
          }),
        )
        .digest('hex'),
      platformAdminId: adminId,
      tenant: tenantRow,
    });
    const replay = await agent
      .post('/api/platform/tenants')
      .set('Idempotency-Key', 'create-synthetic-1')
      .send(body)
      .expect(201);
    expect(replay.body.idempotency_replayed).toBe(true);
    expect(replay.body.temporary_password).toBe(
      created.body.temporary_password,
    );
  });

  it('enforces the location quota before creating a location', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      tenantId,
      tenant: { tenantCode },
      username: null,
      email: 'manager@example.local',
      role: 'tenant_manager',
      status: 'active',
      mustChangePassword: false,
    });
    prisma.tenant.findUnique.mockResolvedValue({ locationLimit: 1 });
    prisma.location.count.mockResolvedValue(1);
    prisma.location.findFirst = jest.fn().mockResolvedValue(null);
    prisma.locationLegacyIdentifier = {
      findFirst: jest.fn().mockResolvedValue(null),
    };
    prisma.location.create = jest.fn();

    const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({
      sub: 'user-1',
      user_id: 'user-1',
      tenant_id: tenantId,
      role: 'tenant_manager',
    });
    const response = await request(app.getHttpServer())
      .post('/api/locations')
      .set('Authorization', `Bearer ${token}`)
      .send({ location_name: 'Over Limit' })
      .expect(409);
    expect(response.body.code).toBe('LOCATION_LIMIT_REACHED');
    expect(prisma.location.create).not.toHaveBeenCalled();
  });
});
