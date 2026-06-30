import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Auth tenant context', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: {
    user: {
      findFirst: jest.Mock;
    };
    subscription: {
      findUnique: jest.Mock;
    };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const email = 'manager@example.local';
  const endAt = new Date('2026-12-31T23:59:59.000Z');

  beforeAll(() => {
    process.env.JWT_SECRET = 'auth-context-spec-secret';
    process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '86400';
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    jwtService = moduleFixture.get(JwtService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each(['root_admin', 'manager'])(
    'protected APIs should allow the %s role through the shared auth context',
    async (role) => {
      prisma.user.findFirst.mockResolvedValue(currentUser(role));
      prisma.subscription.findUnique.mockResolvedValue({
        status: 'active',
        plan: 'mvp',
        endAt,
      });

      await request(app.getHttpServer())
        .get('/api/license/check')
        .set('Authorization', `Bearer ${accessToken(role)}`)
        .expect(200);

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId },
        }),
      );
    },
  );

  it('protected APIs should reject roles outside the MVP role set', async () => {
    prisma.user.findFirst.mockResolvedValue(currentUser('viewer'));

    const response = await request(app.getHttpServer())
      .get('/api/license/check')
      .set('Authorization', `Bearer ${accessToken('viewer')}`)
      .expect(403);

    expect(response.body).toMatchObject({
      code: 'ROLE_FORBIDDEN',
    });
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('business APIs should use the JWT tenant context instead of forged tenant_id query values', async () => {
    prisma.user.findFirst.mockResolvedValue(currentUser('manager'));
    prisma.subscription.findUnique.mockResolvedValue({
      status: 'active',
      plan: 'mvp',
      endAt,
    });

    await request(app.getHttpServer())
      .get('/api/license/check')
      .query({ tenant_id: otherTenantId })
      .set('Authorization', `Bearer ${accessToken('manager')}`)
      .expect(200);

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: userId,
          tenantId,
        },
      }),
    );
    expect(prisma.subscription.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId },
      }),
    );
  });

  function accessToken(role: string) {
    return jwtService.sign({
      sub: userId,
      user_id: userId,
      tenant_id: tenantId,
      role,
    });
  }

  function currentUser(role: string) {
    return {
      id: userId,
      tenantId,
      email,
      role,
    };
  }
});
