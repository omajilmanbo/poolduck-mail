import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Platform control plane', () => {
  let app: INestApplication;
  let passwordHash: string;
  let storedSession: Record<string, unknown> | null;
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

  beforeAll(async () => {
    process.env.PLATFORM_JWT_SECRET = 'platform-test-access-secret';
    process.env.PLATFORM_REFRESH_TOKEN_SECRET = 'platform-test-refresh-secret';
    process.env.PLATFORM_PROVISIONING_SECRET =
      'platform-test-provisioning-secret-with-32-chars';
    passwordHash = await argon2.hash(password);
  });

  beforeEach(async () => {
    storedSession = null;
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
                  status: 'active',
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

    const body = {
      name: 'Synthetic Tenant',
      manager_email: 'manager@example.local',
      subscription_status: 'trial',
      start_at: '2026-07-29T00:00:00.000Z',
      end_at: '2026-08-29T00:00:00.000Z',
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
