import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

const DUMMY_TEST_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$UgDSqK4u6aW1VlnypZuvDw$+J8Xad+ShD8yU2FVCBeeihzR1/yM57cWIt76pnfF8Wk';

describe('Auth API', () => {
  let app: INestApplication;
  let prisma: {
    tenant: { findUnique: jest.Mock };
    user: { findFirst: jest.Mock; update: jest.Mock };
    auditLog: { create: jest.Mock };
    session: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const tenantCode = '10CA000001';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const username = 'local-operator';
  const email = 'operator@example.local';
  const password = 'correct-password';

  beforeAll(() => {
    process.env.JWT_SECRET = 'auth-spec-secret';
    process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
    process.env.JWT_REFRESH_TOKEN_TTL_SECONDS = '604800';
  });

  beforeEach(async () => {
    delete process.env.AUTH_ACCEPT_LEGACY_TENANT_UUID;
    process.env.AUTH_LOGIN_MAX_PER_IP = '1000';
    process.env.AUTH_LOGIN_MAX_PER_TENANT = '1000';
    process.env.AUTH_LOGIN_MAX_PER_IDENTIFIER = '1000';
    process.env.AUTH_LOGIN_MAX_PER_COMPOSITE = '1000';
    prisma = {
      tenant: { findUnique: jest.fn() },
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      session: {
        create: jest.fn().mockResolvedValue(undefined),
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('logs in an email-less operator by normalized username and sets HttpOnly cookies', async () => {
    const passwordHash = await argon2.hash(password);
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, tenantCode });
    prisma.user.findFirst.mockResolvedValue(
      operatorUser({ email: null, passwordHash }),
    );
    prisma.user.update.mockResolvedValue(undefined);

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_code: ' 10ca000001 ',
        identifier: ' LOCAL-OPERATOR ',
        password,
      })
      .expect(201);

    expect(response.body.access_token).toBeUndefined();
    expect(response.body.expires_in).toBe(900);
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^poolduck_access=.*HttpOnly.*SameSite=Lax/),
        expect.stringMatching(/^poolduck_refresh=.*HttpOnly.*SameSite=Lax/),
      ]),
    );
    expect(response.body.user).toEqual({
      user_id: userId,
      tenant_code: tenantCode,
      username,
      email: null,
      role: 'operator',
    });
    expect(response.body.user.tenant_id).toBeUndefined();
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { tenantCode },
      select: { id: true, tenantCode: true },
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, username, role: 'operator' },
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: { lastLoginAt: expect.any(Date) },
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        actorUserId: userId,
        action: 'auth.login',
        result: 'success',
      }),
    });
  });

  it('logs in an operator by normalized optional email', async () => {
    const passwordHash = await argon2.hash(password);
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, tenantCode });
    prisma.user.findFirst.mockResolvedValue(operatorUser({ passwordHash }));
    prisma.user.update.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_code: tenantCode,
        identifier: 'Operator@Example.Local',
        password,
      })
      .expect(201);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, email },
      }),
    );
  });

  it('rejects UUID tenant login by default and malformed public tenant codes', async () => {
    const legacyResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_id: tenantId,
        identifier: username,
        password,
      })
      .expect(401);
    expect(legacyResponse.body).toMatchObject({ code: 'LOGIN_FAILED' });

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_code: 'INVALID-I',
        identifier: username,
        password,
      })
      .expect(400);

    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('allows UUID tenant login only during an explicit rollback window', async () => {
    process.env.AUTH_ACCEPT_LEGACY_TENANT_UUID = 'true';
    const passwordHash = await argon2.hash(password);
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, tenantCode });
    prisma.user.findFirst.mockResolvedValue(operatorUser({ passwordHash }));
    prisma.user.update.mockResolvedValue(undefined);

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ tenant_id: tenantId, identifier: username, password })
      .expect(201);

    expect(response.body.user).toMatchObject({ tenant_code: tenantCode });
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: tenantId },
      select: { id: true, tenantCode: true },
    });
  });

  it('requires tenant_manager to log in by email', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, tenantCode });
    prisma.user.findFirst.mockResolvedValue(null);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ tenant_code: tenantCode, identifier: 'tenant-manager', password })
      .expect(401);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          username: 'tenant-manager',
          role: 'operator',
        },
      }),
    );
  });

  it.each([
    ['tenant does not exist', null, null, password],
    [
      'identity is in another tenant',
      { id: tenantId, tenantCode },
      null,
      password,
    ],
    [
      'password is wrong',
      { id: tenantId, tenantCode },
      operatorUser({ passwordHash: 'not-an-argon-hash' }),
      'wrong-password',
    ],
    [
      'user is disabled',
      { id: tenantId, tenantCode },
      operatorUser({ status: 'inactive' }),
      password,
    ],
  ])(
    'returns the same login error when %s',
    async (_case, tenant, user, suppliedPassword) => {
      prisma.tenant.findUnique.mockResolvedValue(tenant);
      prisma.user.findFirst.mockResolvedValue(user);

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          tenant_code: tenantCode,
          identifier: email,
          password: suppliedPassword,
        })
        .expect(401);

      expect(response.body).toMatchObject({
        code: 'LOGIN_FAILED',
        message: '登录失败',
      });
      expect(JSON.stringify(response.body)).not.toContain('tenant');
      expect(JSON.stringify(response.body)).not.toContain('disabled');
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );

  it.each(['ｌocal-operator', 'admin'])(
    'rejects invalid or reserved username %s with the generic login error',
    async (identifier) => {
      prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, tenantCode });

      const response = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ tenant_code: tenantCode, identifier, password })
        .expect(401);

      expect(response.body.code).toBe('LOGIN_FAILED');
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    },
  );

  it('supports a matching legacy email field during the compatibility window', async () => {
    const passwordHash = await argon2.hash(password);
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, tenantCode });
    prisma.user.findFirst.mockResolvedValue(operatorUser({ passwordHash }));
    prisma.user.update.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_code: tenantCode,
        identifier: 'Operator@Example.Local',
        email,
        password,
      })
      .expect(201);
  });

  it('rejects conflicting legacy and new identity fields without querying a user', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_code: tenantCode,
        identifier: username,
        email,
        password,
      })
      .expect(401);

    expect(response.body.code).toBe('LOGIN_FAILED');
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('rate limits a repeated tenant and identifier hash without revealing account state', async () => {
    process.env.AUTH_LOGIN_MAX_PER_IDENTIFIER = '2';
    process.env.AUTH_LOGIN_MAX_PER_COMPOSITE = '2';
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, tenantCode });
    prisma.user.findFirst.mockResolvedValue(null);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ tenant_code: tenantCode, identifier: username, password })
        .expect(401);
    }

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ tenant_code: tenantCode, identifier: username, password })
      .expect(429);
    expect(response.body).toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
  });

  it('returns the current user from signed-token tenant context', async () => {
    const passwordHash = await argon2.hash(password);
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, tenantCode });
    prisma.user.findFirst
      .mockResolvedValueOnce(managerUser({ passwordHash }))
      .mockResolvedValueOnce(managerUser());
    prisma.user.update.mockResolvedValue(undefined);

    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ tenant_code: tenantCode, identifier: email, password })
      .expect(201);

    await agent
      .get('/api/auth/me')
      .query({ tenant_id: otherTenantId })
      .expect(200)
      .expect({
        user: {
          user_id: userId,
          tenant_code: tenantCode,
          username: null,
          email,
          role: 'tenant_manager',
        },
      });

    expect(prisma.user.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: userId, tenantId },
      }),
    );
  });

  it('rejects a token after its user is disabled', async () => {
    prisma.user.findFirst.mockResolvedValue(
      operatorUser({ status: 'inactive' }),
    );
    const jwt = moduleToken({ userId, tenantId, role: 'operator' });

    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${jwt}`)
      .expect(401);

    expect(response.body).toMatchObject({ code: 'USER_DISABLED' });
  });

  it('rejects unauthenticated and invalid-token requests', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'UNAUTHORIZED', message: '未认证' });
      });

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'UNAUTHORIZED', message: '未认证' });
      });
  });

  it('rotates the refresh token and revokes only the current session on logout', async () => {
    const passwordHash = await argon2.hash(password);
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId, tenantCode });
    prisma.user.findFirst.mockResolvedValue(operatorUser({ passwordHash }));
    prisma.user.update.mockResolvedValue(undefined);
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ tenant_code: tenantCode, identifier: email, password })
      .expect(201);

    const created = prisma.session.create.mock.calls[0][0].data;
    prisma.session.findFirst.mockResolvedValue({
      id: created.id,
      refreshTokenHash: created.refreshTokenHash,
      user: operatorUser(),
    });
    const refreshResponse = await agent.post('/api/auth/refresh').expect(201);
    expect(refreshResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringMatching(/^poolduck_refresh=/)]),
    );
    expect(prisma.session.update).toHaveBeenCalledWith({
      where: { id: created.id },
      data: {
        refreshTokenHash: expect.not.stringMatching(
          `^${created.refreshTokenHash}$`,
        ),
        lastUsedAt: expect.any(Date),
      },
    });

    await agent.post('/api/auth/logout').expect(201).expect({ status: 'ok' });
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: {
        id: created.id,
        refreshTokenHash: expect.any(String),
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });

  function operatorUser(overrides: Record<string, unknown> = {}) {
    return {
      id: userId,
      tenantId,
      username,
      email,
      passwordHash: DUMMY_TEST_HASH,
      role: 'operator',
      status: 'active',
      tenant: { tenantCode },
      ...overrides,
    };
  }

  function managerUser(overrides: Record<string, unknown> = {}) {
    return {
      id: userId,
      tenantId,
      username: null,
      email,
      passwordHash: DUMMY_TEST_HASH,
      role: 'tenant_manager',
      status: 'active',
      tenant: { tenantCode },
      ...overrides,
    };
  }

  function moduleToken(input: {
    userId: string;
    tenantId: string;
    role: string;
  }) {
    const jwtService = app.get(JwtService);
    return jwtService.sign({
      sub: input.userId,
      user_id: input.userId,
      tenant_id: input.tenantId,
      role: input.role,
    });
  }
});
