import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Mail Jobs API', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: {
    user: {
      findFirst: jest.Mock;
    };
    subscription: {
      findUnique: jest.Mock;
    };
    mailJob: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const userId = '33333333-3333-4333-8333-333333333333';
  const mailJobId = '66666666-6666-4666-8666-666666666666';
  const email = 'manager@example.local';
  const sentAt = new Date('2026-06-22T04:05:06.000Z');

  beforeAll(() => {
    process.env.JWT_SECRET = 'mail-jobs-spec-secret';
    process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '86400';
  });

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(sentAt);
    delete process.env.MAIL_MOCK_SEND_RESULT;

    prisma = {
      user: {
        findFirst: jest.fn(),
      },
      subscription: {
        findUnique: jest.fn(),
      },
      mailJob: {
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
    jwtService = moduleFixture.get(JwtService);
    await app.init();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await app.close();
  });

  it('POST /api/mail-jobs/:mail_job_id/send should mark queued mail_job as sent for sandbox success', async () => {
    mockAuthenticatedUser();
    mockSubscription('active');
    mockMailJob('queued');
    prisma.mailJob.update.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .post(`/api/mail-jobs/${mailJobId}/send`)
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(201)
      .expect({
        mail_job_id: mailJobId,
        status: 'sent',
        provider_result: {
          provider: 'sandbox',
          success: true,
          provider_message_id: `sandbox_${mailJobId}`,
        },
      });

    expect(prisma.mailJob.findFirst).toHaveBeenCalledWith({
      where: {
        id: mailJobId,
        tenantId,
      },
      select: {
        id: true,
        status: true,
        toEmail: true,
        subject: true,
        body: true,
      },
    });
    expect(prisma.mailJob.update).toHaveBeenCalledWith({
      where: { id: mailJobId },
      data: {
        status: 'sent',
        providerMessageId: `sandbox_${mailJobId}`,
        errorMessage: null,
        sentAt,
      },
    });
  });

  it('POST /api/mail-jobs/:mail_job_id/send should mark mail_job as failed for sandbox failure', async () => {
    process.env.MAIL_MOCK_SEND_RESULT = 'failure';
    mockAuthenticatedUser();
    mockSubscription('active');
    mockMailJob('queued');
    prisma.mailJob.update.mockResolvedValue(undefined);

    await request(app.getHttpServer())
      .post(`/api/mail-jobs/${mailJobId}/send`)
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(201)
      .expect({
        mail_job_id: mailJobId,
        status: 'failed',
        provider_result: {
          provider: 'sandbox',
          success: false,
          error_message: 'Sandbox provider simulated failure',
        },
      });

    expect(prisma.mailJob.update).toHaveBeenCalledWith({
      where: { id: mailJobId },
      data: {
        status: 'failed',
        errorMessage: 'Sandbox provider simulated failure',
        providerMessageId: undefined,
      },
    });
  });

  it('POST /api/mail-jobs/:mail_job_id/send should reject cross-tenant mail_jobs', async () => {
    mockAuthenticatedUser();
    prisma.mailJob.findFirst.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post(`/api/mail-jobs/${mailJobId}/send`)
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'MAIL_JOB_NOT_FOUND',
    });
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    expect(prisma.mailJob.update).not.toHaveBeenCalled();
  });

  it.each(['expired', 'suspended'])(
    'POST /api/mail-jobs/:mail_job_id/send should reject %s subscriptions',
    async (status) => {
      mockAuthenticatedUser();
      mockMailJob('queued');
      mockSubscription(status);

      const response = await request(app.getHttpServer())
        .post(`/api/mail-jobs/${mailJobId}/send`)
        .set('Authorization', `Bearer ${accessToken()}`)
        .expect(403);

      expect(response.body).toMatchObject({
        code: 'SUBSCRIPTION_NOT_SENDABLE',
      });
      expect(prisma.mailJob.update).not.toHaveBeenCalled();
    },
  );

  it('POST /api/mail-jobs/:mail_job_id/send should reject already sent mail_jobs', async () => {
    mockAuthenticatedUser();
    mockMailJob('sent');
    mockSubscription('active');

    const response = await request(app.getHttpServer())
      .post(`/api/mail-jobs/${mailJobId}/send`)
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(409);

    expect(response.body).toMatchObject({
      code: 'MAIL_JOB_ALREADY_SENT',
    });
    expect(prisma.mailJob.update).not.toHaveBeenCalled();
  });

  it('POST /api/mail-jobs/:mail_job_id/send should reject unauthenticated requests', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/mail-jobs/${mailJobId}/send`)
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: '未认证',
    });
    expect(prisma.mailJob.findFirst).not.toHaveBeenCalled();
    expect(prisma.mailJob.update).not.toHaveBeenCalled();
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

  function mockMailJob(status: string) {
    prisma.mailJob.findFirst.mockResolvedValue({
      id: mailJobId,
      status,
      toEmail: 'taro.yamada@example.local',
      subject: 'Office Aからのお知らせ',
      body: 'mail body',
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
