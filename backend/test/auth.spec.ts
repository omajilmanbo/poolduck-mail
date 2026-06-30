import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Auth API', () => {
  let app: INestApplication;
  let prisma: {
    tenant: {
      findUnique: jest.Mock;
    };
    user: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const email = 'manager@example.local';
  const password = 'correct-password';

  beforeAll(async () => {
    process.env.JWT_SECRET = 'auth-spec-secret';
    process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '86400';
  });

  beforeEach(async () => {
    prisma = {
      tenant: {
        findUnique: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        update: jest.fn(),
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

  it('POST /api/auth/login should return an access token for a valid tenant user', async () => {
    const passwordHash = await argon2.hash(password);
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      tenantId,
      email,
      passwordHash,
      role: 'manager',
    });
    prisma.user.update.mockResolvedValue(undefined);

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_id: tenantId,
        email,
        password,
      })
      .expect(201);

    expect(response.body.access_token).toEqual(expect.any(String));
    expect(response.body.expires_in).toBe(86400);
    expect(response.body.user).toEqual({
      user_id: userId,
      tenant_id: tenantId,
      email,
      role: 'manager',
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId,
          email,
        },
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: { lastLoginAt: expect.any(Date) },
      }),
    );
  });

  it('POST /api/auth/login should return a recognizable error when tenant_id does not exist', async () => {
    prisma.tenant.findUnique.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_id: tenantId,
        email,
        password,
      })
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'TENANT_NOT_FOUND',
      message: 'tenant不存在',
    });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('POST /api/auth/login should fail when the user does not belong to the tenant', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.user.findFirst.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_id: tenantId,
        email,
        password,
      })
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'LOGIN_FAILED',
      message: '登录失败',
    });
  });

  it('POST /api/auth/login should fail when the password is wrong', async () => {
    const passwordHash = await argon2.hash(password);
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      tenantId,
      email,
      passwordHash,
      role: 'manager',
    });

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_id: tenantId,
        email,
        password: 'wrong-password',
      })
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'LOGIN_FAILED',
      message: '登录失败',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('GET /api/auth/me should return the current user from the signed token tenant context', async () => {
    const passwordHash = await argon2.hash(password);
    prisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    prisma.user.findFirst
      .mockResolvedValueOnce({
        id: userId,
        tenantId,
        email,
        passwordHash,
        role: 'root_admin',
      })
      .mockResolvedValueOnce({
        id: userId,
        tenantId,
        email,
        role: 'root_admin',
      });
    prisma.user.update.mockResolvedValue(undefined);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        tenant_id: tenantId,
        email,
        password,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .query({ tenant_id: otherTenantId })
      .set('Authorization', `Bearer ${loginResponse.body.access_token}`)
      .expect(200)
      .expect({
        user: {
          user_id: userId,
          tenant_id: tenantId,
          email,
          role: 'root_admin',
        },
      });

    expect(prisma.user.findFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: userId,
          tenantId,
        },
      }),
    );
  });

  it('GET /api/auth/me should reject unauthenticated requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: '未认证',
    });
  });

  it('GET /api/auth/me should reject invalid tokens', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: '未认证',
    });
  });
});
