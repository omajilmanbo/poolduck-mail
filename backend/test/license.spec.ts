import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';
import { LicenseService } from '../src/license/license.service';

describe('License API', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let licenseService: LicenseService;
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
    process.env.JWT_SECRET = 'license-spec-secret';
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
    licenseService = moduleFixture.get(LicenseService);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ['trial', true],
    ['active', true],
    ['expired', false],
    ['suspended', false],
  ])(
    'GET /api/license/check should return %s as can_send=%s for the current tenant',
    async (status, canSend) => {
      prisma.user.findFirst.mockResolvedValue(currentUser());
      prisma.subscription.findUnique.mockResolvedValue({
        status,
        plan: 'mvp',
        endAt,
      });

      await request(app.getHttpServer())
        .get('/api/license/check')
        .set('Authorization', `Bearer ${accessToken()}`)
        .expect(200)
        .expect({
          status,
          plan: 'mvp',
          end_at: endAt.toISOString(),
          expired_at: endAt.toISOString(),
          grace_period: null,
          can_send: canSend,
        });

      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { tenantId },
        select: {
          plan: true,
          status: true,
          endAt: true,
        },
      });
    },
  );

  it('GET /api/license/check should reject unauthenticated requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/license/check')
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: '未认证',
    });
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it('GET /api/license/check should ignore forged tenant_id query parameters', async () => {
    prisma.user.findFirst.mockResolvedValue(currentUser());
    prisma.subscription.findUnique.mockResolvedValue({
      status: 'active',
      plan: 'mvp',
      endAt,
    });

    await request(app.getHttpServer())
      .get('/api/license/check')
      .query({ tenant_id: otherTenantId })
      .set('Authorization', `Bearer ${accessToken()}`)
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

  it('LicenseService canSendForStatus should be reusable by later scan and mail APIs', () => {
    expect(licenseService.canSendForStatus('trial')).toBe(true);
    expect(licenseService.canSendForStatus('active')).toBe(true);
    expect(licenseService.canSendForStatus('expired')).toBe(false);
    expect(licenseService.canSendForStatus('suspended')).toBe(false);
    expect(licenseService.canSendForStatus('unknown')).toBe(false);
  });

  function accessToken() {
    return jwtService.sign({
      sub: userId,
      user_id: userId,
      tenant_id: tenantId,
      role: 'manager',
    });
  }

  function currentUser() {
    return {
      id: userId,
      tenantId,
      email,
      role: 'manager',
    };
  }
});
