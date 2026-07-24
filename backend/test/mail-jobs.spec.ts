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
      findFirstOrThrow: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const userId = '33333333-3333-4333-8333-333333333333';
  const mailJobId = '66666666-6666-4666-8666-666666666666';
  const email = 'operator@example.local';
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
        findFirstOrThrow: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
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
        retry_count: 0,
        scheduled_at: null,
        provider_result: {
          provider: 'sandbox',
          success: true,
          provider_message_id: `sandbox_${mailJobId}`,
        },
      });

    expect(prisma.mailJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: mailJobId,
        tenantId,
        status: 'queued',
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: sentAt } }],
      },
      data: { status: 'processing' },
    });
    expect(prisma.mailJob.update).toHaveBeenCalledWith({
      where: { id: mailJobId },
      data: {
        status: 'sent',
        providerMessageId: `sandbox_${mailJobId}`,
        errorMessage: null,
        scheduledAt: null,
        sentAt,
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'mail.send',
        resourceId: mailJobId,
        result: 'success',
        metadataJson: { provider: 'sandbox' },
      }),
    });
  });

  it('POST /api/mail-jobs/:mail_job_id/send should schedule the first sandbox retry after 30 seconds', async () => {
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
        status: 'queued',
        retry_count: 1,
        scheduled_at: '2026-06-22T04:05:36.000Z',
        provider_result: {
          provider: 'sandbox',
          success: false,
          error_message: 'Sandbox provider simulated failure',
        },
      });

    expect(prisma.mailJob.update).toHaveBeenCalledWith({
      where: { id: mailJobId },
      data: {
        status: 'queued',
        retryCount: 1,
        scheduledAt: new Date('2026-06-22T04:05:36.000Z'),
        errorMessage: 'Sandbox provider simulated failure',
        providerMessageId: undefined,
      },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'mail.retry.scheduled',
        result: 'failure',
        metadataJson: {
          provider: 'sandbox',
          reason: 'PROVIDER_FAILURE',
          retry_count: 1,
          scheduled_at: '2026-06-22T04:05:36.000Z',
        },
      }),
    });
  });

  it('POST /api/mail-jobs/:mail_job_id/send should reject cross-tenant mail_jobs', async () => {
    mockAuthenticatedUser();
    prisma.mailJob.updateMany.mockResolvedValue({ count: 0 });
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
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'authorization.mail_job.denied',
        result: 'denied',
      }),
    });
  });

  it.each(['expired', 'suspended'])(
    'POST /api/mail-jobs/:mail_job_id/send should terminally fail %s subscriptions',
    async (status) => {
      mockAuthenticatedUser();
      mockMailJob('queued');
      mockSubscription(status);

      const response = await request(app.getHttpServer())
        .post(`/api/mail-jobs/${mailJobId}/send`)
        .set('Authorization', `Bearer ${accessToken()}`)
        .expect(201);

      expect(response.body).toMatchObject({
        status: 'failed',
        retry_count: 0,
        scheduled_at: null,
        provider_result: { error_message: 'SUBSCRIPTION_NOT_SENDABLE' },
      });
      expect(prisma.mailJob.update).toHaveBeenCalledWith({
        where: { id: mailJobId },
        data: {
          status: 'failed',
          scheduledAt: null,
          errorMessage: 'SUBSCRIPTION_NOT_SENDABLE',
        },
      });
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
      role: 'operator',
      status: 'active',
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
    prisma.mailJob.updateMany.mockResolvedValue({ count: status === 'queued' ? 1 : 0 });
    prisma.mailJob.findFirst.mockResolvedValue({
      id: mailJobId,
      status,
      scheduledAt: null,
    });
    prisma.mailJob.findFirstOrThrow.mockResolvedValue({
      id: mailJobId,
      toEmail: 'taro.yamada@example.local',
      subject: 'Office Aからのお知らせ',
      body: 'mail body',
      retryCount: 0,
    });
  }

  function accessToken() {
    return jwtService.sign({
      sub: userId,
      user_id: userId,
      tenant_id: tenantId,
      role: 'operator',
    });
  }
});
