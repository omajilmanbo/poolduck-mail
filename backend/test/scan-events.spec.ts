import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Scan Events API', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: {
    $transaction: jest.Mock;
    user: {
      findFirst: jest.Mock;
    };
    subscription: {
      findUnique: jest.Mock;
    };
    location: {
      findFirst: jest.Mock;
    };
    personMapping: {
      findFirst: jest.Mock;
    };
    scanEvent: {
      create: jest.Mock;
    };
    mailJob: {
      create: jest.Mock;
    };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const locationId = '44444444-4444-4444-8444-444444444444';
  const scanEventId = '55555555-5555-4555-8555-555555555555';
  const mailJobId = '66666666-6666-4666-8666-666666666666';
  const email = 'manager@example.local';
  const receivedAt = new Date('2026-06-22T03:04:05.000Z');

  beforeAll(() => {
    process.env.JWT_SECRET = 'scan-events-spec-secret';
    process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '86400';
  });

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(receivedAt);

    prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof prisma) => unknown) =>
        callback(prisma),
      ),
      user: {
        findFirst: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
      },
      location: {
        findFirst: jest.fn(),
      },
      personMapping: {
        findFirst: jest.fn(),
      },
      scanEvent: {
        create: jest.fn(),
      },
      mailJob: {
        create: jest.fn(),
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
    jest.useRealTimers();
    await app.close();
  });

  it.each(['trial', 'active'])(
    'POST /api/scan-events should create scan_event and queued mail_job for %s subscriptions',
    async (status) => {
      mockAuthenticatedUser();
      mockSubscription(status);
      mockLocation();
      prisma.personMapping.findFirst.mockResolvedValue({
        personName: '山田 太郎',
        email: 'taro.yamada@example.local',
      });
      prisma.scanEvent.create.mockResolvedValue({ id: scanEventId });
      prisma.mailJob.create.mockResolvedValue({ id: mailJobId });

      await request(app.getHttpServer())
        .post('/api/scan-events')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({
          location_id: locationId,
          scan_code: 'SCAN-001',
        })
        .expect(201)
        .expect({
          scan_event_id: scanEventId,
          mail_job_id: mailJobId,
          mail_subject: 'Office Aからのお知らせ',
          status: 'queued',
        });

      expect(prisma.location.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: locationId,
            tenantId,
          },
        }),
      );
      expect(prisma.personMapping.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          locationId,
          scanCode: 'SCAN-001',
          status: 'active',
        },
        select: {
          personName: true,
          email: true,
        },
      });
      expect(prisma.scanEvent.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          locationId,
          scanCode: 'SCAN-001',
          scanType: 'entry',
          rawPayload: JSON.stringify({
            location_id: locationId,
            scan_code: 'SCAN-001',
          }),
          receivedAt,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      expect(prisma.mailJob.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          scanEventId,
          toEmail: 'taro.yamada@example.local',
          subject: 'Office Aからのお知らせ',
          body: 'Poolduck Tenant，Office Aからのお知らせ：山田 太郎　さんは　2026-06-22T03:04:05.000Z　に入室しました。',
          templateKey: 'scan_entry_notice_v1',
          status: 'queued',
        },
        select: { id: true },
      });
    },
  );

  it('POST /api/scan-events should record an unmapped scan_event and skip mail_job when scan_code is not mapped', async () => {
    mockAuthenticatedUser();
    mockSubscription('active');
    mockLocation();
    prisma.personMapping.findFirst.mockResolvedValue(null);
    prisma.scanEvent.create.mockResolvedValue({ id: scanEventId });

    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({
        location_id: locationId,
        scan_code: 'UNKNOWN',
      })
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'SCAN_CODE_NOT_MAPPED',
      message: 'scan_code未找到映射邮箱',
      scan_event_id: scanEventId,
    });
    expect(prisma.scanEvent.create).toHaveBeenCalledWith({
      data: {
        tenantId,
        locationId,
        scanCode: 'UNKNOWN',
        scanType: 'unmapped',
        rawPayload: JSON.stringify({
          location_id: locationId,
          scan_code: 'UNKNOWN',
        }),
        receivedAt,
        createdByUserId: userId,
      },
      select: { id: true },
    });
    expect(prisma.mailJob.create).not.toHaveBeenCalled();
  });

  it.each(['expired', 'suspended'])(
    'POST /api/scan-events should reject %s subscriptions before creating scan_event or mail_job',
    async (status) => {
      mockAuthenticatedUser();
      mockSubscription(status);

      const response = await request(app.getHttpServer())
        .post('/api/scan-events')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({
          location_id: locationId,
          scan_code: 'SCAN-001',
        })
        .expect(403);

      expect(response.body).toMatchObject({
        code: 'SUBSCRIPTION_NOT_SENDABLE',
      });
      expect(prisma.location.findFirst).not.toHaveBeenCalled();
      expect(prisma.scanEvent.create).not.toHaveBeenCalled();
      expect(prisma.mailJob.create).not.toHaveBeenCalled();
    },
  );

  it('POST /api/scan-events should reject cross-tenant locations', async () => {
    mockAuthenticatedUser();
    mockSubscription('active');
    prisma.location.findFirst.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({
        location_id: locationId,
        scan_code: 'SCAN-001',
      })
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'LOCATION_NOT_FOUND',
    });
    expect(prisma.personMapping.findFirst).not.toHaveBeenCalled();
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
    expect(prisma.mailJob.create).not.toHaveBeenCalled();
  });

  it('POST /api/scan-events should reject custom mail body fields', async () => {
    mockAuthenticatedUser();

    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({
        location_id: locationId,
        scan_code: 'SCAN-001',
        custom_message: 'please use this',
        custom_text: 'please use this too',
        mail_body: 'override body',
      })
      .expect(400);

    expect(response.body.message).toEqual(
      expect.arrayContaining([
        'property custom_message should not exist',
        'property custom_text should not exist',
        'property mail_body should not exist',
      ]),
    );
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
    expect(prisma.mailJob.create).not.toHaveBeenCalled();
  });

  it('POST /api/scan-events should reject unauthenticated requests', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .send({
        location_id: locationId,
        scan_code: 'SCAN-001',
      })
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: '未认证',
    });
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
    expect(prisma.mailJob.create).not.toHaveBeenCalled();
  });

  function mockAuthenticatedUser() {
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      tenantId,
      email,
      role: 'manager',
    });
  }

  function mockSubscription(status: string) {
    prisma.subscription.findUnique.mockResolvedValue({
      status,
      plan: 'mvp',
      endAt: new Date('2026-12-31T23:59:59.000Z'),
    });
  }

  function mockLocation() {
    prisma.location.findFirst.mockResolvedValue({
      id: locationId,
      name: 'Office A',
      tenant: {
        name: 'Poolduck Tenant',
      },
    });
  }

  function accessToken() {
    return jwtService.sign({
      sub: userId,
      user_id: userId,
      tenant_id: tenantId,
      role: 'manager',
    });
  }
});
