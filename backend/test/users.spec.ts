import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Tenant operator lifecycle API', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: {
    user: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    session: { updateMany: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const managerId = '33333333-3333-4333-8333-333333333333';
  const operatorId = '44444444-4444-4444-8444-444444444444';
  const now = new Date('2026-07-23T01:02:03.000Z');

  beforeAll(() => {
    process.env.JWT_SECRET = 'users-spec-secret';
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      session: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    authenticateAs('tenant_manager');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleFixture.createNestApplication({ logger: false });
    jwtService = moduleFixture.get(JwtService);
    await app.init();
  });

  afterEach(async () => app.close());

  it('lists current-tenant operators with username and optional email but no password material', async () => {
    prisma.user.findMany.mockResolvedValue([operatorRow({ email: null })]);
    const response = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .expect(200);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, role: 'operator' },
        orderBy: [{ username: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(response.body[0]).toEqual({
      user_id: operatorId,
      username: 'local-operator',
      email: null,
      role: 'operator',
      status: 'active',
      last_login_at: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('creates an email-less operator with normalized username and Argon2 password', async () => {
    prisma.user.create.mockImplementation(async ({ data }) =>
      operatorRow({
        username: data.username,
        email: data.email,
        passwordHash: data.passwordHash,
      }),
    );
    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({
        username: ' New.Operator ',
        password: 'abc12345',
        role: 'operator',
      })
      .expect(201);

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId,
      username: 'new.operator',
      email: null,
      role: 'operator',
      status: 'active',
    });
    expect(await argon2.verify(data.passwordHash, 'abc12345')).toBe(true);
    expect(response.body).toMatchObject({
      username: 'new.operator',
      email: null,
    });
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('normalizes an optional operator email', async () => {
    prisma.user.create.mockImplementation(async ({ data }) =>
      operatorRow({ username: data.username, email: data.email }),
    );
    await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({
        username: 'email-operator',
        email: 'New.Operator@Example.Local',
        password: 'abc12345',
      })
      .expect(201);
    expect(prisma.user.create.mock.calls[0][0].data.email).toBe(
      'new.operator@example.local',
    );
  });

  it.each([
    ['short7', 'less than eight characters'],
    ['abcdefgh', 'missing a number'],
    ['12345678', 'missing a letter'],
    ['!!!!abcd', 'missing a number even when symbols are present'],
  ])('rejects password %s (%s)', async (password) => {
    await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({ username: 'new-operator', password })
      .expect(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it.each(['ab', 'operator', 'ｏperator', 'bad@name', '-leading'])(
    'rejects invalid, Unicode, or reserved username %s',
    async (username) => {
      const response = await request(app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${token('tenant_manager')}`)
        .send({ username, password: 'abc12345' })
        .expect(400);
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(prisma.user.create).not.toHaveBeenCalled();
    },
  );

  it('rejects operator callers and tenant_manager role creation', async () => {
    authenticateAs('operator');
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${token('operator')}`)
      .expect(403);

    authenticateAs('tenant_manager');
    await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({
        username: 'manager-two',
        email: 'manager2@example.local',
        password: 'abc12345',
        role: 'tenant_manager',
      })
      .expect(400);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it.each([
    ['username', 'USER_USERNAME_CONFLICT'],
    ['email', 'USER_EMAIL_CONFLICT'],
  ])('maps duplicate tenant %s to a field-specific conflict', async (field, code) => {
    prisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: [`tenant_id`, field] },
      }),
    );
    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({
        username: 'local-operator',
        email: 'operator@example.local',
        password: 'abc12345',
      })
      .expect(409);
    expect(response.body).toMatchObject({ code });
  });

  it('returns a generic server error when persistence is unavailable', async () => {
    prisma.user.create.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer())
      .post('/api/users')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({ username: 'new-operator', password: 'abc12345' })
      .expect(500);
    expect(response.body.message).toBe('Internal server error');
    expect(JSON.stringify(response.body)).not.toContain('database unavailable');
  });

  it('updates username, clears email, and revokes all existing sessions', async () => {
    mockManagedTarget();
    prisma.user.update.mockResolvedValue(
      operatorRow({ username: 'renamed-operator', email: null }),
    );
    const response = await request(app.getHttpServer())
      .patch(`/api/users/${operatorId}`)
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({
        username: 'Renamed-Operator',
        email: null,
        role: 'operator',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      username: 'renamed-operator',
      email: null,
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          username: 'renamed-operator',
          email: null,
          role: 'operator',
        },
      }),
    );
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { tenantId, userId: operatorId, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'auth.sessions.revoke',
        metadataJson: expect.objectContaining({
          reason: 'IDENTITY_CHANGED',
        }),
      }),
    });
  });

  it('disables an operator, revokes sessions, and records the manager actor', async () => {
    mockManagedTarget();
    prisma.user.update.mockResolvedValue(operatorRow({ status: 'inactive' }));
    const response = await request(app.getHttpServer())
      .patch(`/api/users/${operatorId}`)
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({ status: 'inactive' })
      .expect(200);

    expect(response.body.status).toBe('inactive');
    expect(prisma.session.updateMany).toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: managerId,
        action: 'user.operator.disabled',
      }),
    });
  });

  it('resets an operator password and revokes all sessions without returning the hash', async () => {
    mockManagedTarget();
    prisma.user.update.mockResolvedValue(undefined);
    const response = await request(app.getHttpServer())
      .post(`/api/users/${operatorId}/password`)
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({ new_password: 'newpass8' })
      .expect(201);

    const passwordHash = prisma.user.update.mock.calls[0][0].data.passwordHash;
    expect(await argon2.verify(passwordHash, 'newpass8')).toBe(true);
    expect(response.body).toEqual({
      user_id: operatorId,
      status: 'password_reset',
    });
    expect(JSON.stringify(response.body)).not.toContain(passwordHash);
    expect(prisma.session.updateMany).toHaveBeenCalled();
  });

  it('uses the same 404 for cross-tenant and tenant_manager targets', async () => {
    prisma.user.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(
        where.id === managerId && where.role === undefined
          ? managerUser()
          : null,
      ),
    );
    const crossTenant = await request(app.getHttpServer())
      .patch('/api/users/55555555-5555-4555-8555-555555555555')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({ status: 'inactive' })
      .expect(404);
    const managerTarget = await request(app.getHttpServer())
      .patch(`/api/users/${managerId}`)
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({ status: 'inactive' })
      .expect(404);

    expect(crossTenant.body.code).toBe('MANAGED_OPERATOR_NOT_FOUND');
    expect(managerTarget.body.code).toBe('MANAGED_OPERATOR_NOT_FOUND');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  function authenticateAs(role: 'tenant_manager' | 'operator') {
    prisma.user.findFirst.mockImplementation(({ where }) => {
      if (where.id === managerId) return Promise.resolve(managerUser(role));
      return Promise.resolve(null);
    });
  }

  function mockManagedTarget() {
    prisma.user.findFirst.mockImplementation(({ where }) => {
      if (where.id === managerId) return Promise.resolve(managerUser());
      if (
        where.id === operatorId &&
        where.tenantId === tenantId &&
        where.role === 'operator'
      ) {
        return Promise.resolve({ id: operatorId });
      }
      return Promise.resolve(null);
    });
  }

  function managerUser(
    role: 'tenant_manager' | 'operator' = 'tenant_manager',
  ) {
    return {
      id: managerId,
      tenantId,
      username: role === 'operator' ? 'manager-as-operator' : null,
      email: `${role}@example.local`,
      role,
      status: 'active',
    };
  }

  function operatorRow(overrides: Record<string, unknown> = {}) {
    return {
      id: operatorId,
      username: 'local-operator',
      email: 'operator@example.local',
      role: 'operator',
      status: 'active',
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function token(role: 'tenant_manager' | 'operator') {
    return jwtService.sign({
      sub: managerId,
      user_id: managerId,
      tenant_id: tenantId,
      role,
    });
  }
});
