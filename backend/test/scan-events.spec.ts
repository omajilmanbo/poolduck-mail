import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Scan Events API', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: {
    $transaction: jest.Mock;
    $executeRawUnsafe: jest.Mock;
    $queryRawUnsafe: jest.Mock;
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
      findFirst: jest.Mock;
    };
    mailJob: {
      create: jest.Mock;
      updateMany: jest.Mock;
      findFirst: jest.Mock;
      findFirstOrThrow: jest.Mock;
      update: jest.Mock;
    };
    scanRequestIdempotency: {
      findFirst: jest.Mock;
      upsert: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const userId = '33333333-3333-4333-8333-333333333333';
  const locationId = '44444444-4444-4444-8444-444444444444';
  const scanEventId = '55555555-5555-4555-8555-555555555555';
  const mailJobId = '66666666-6666-4666-8666-666666666666';
  const personMappingId = '77777777-7777-4777-8777-777777777777';
  const personCode = '01K0ABC50001';
  const unmappedPersonCode = '01K0ABC59999';
  const entryActionCode = `V2E${personCode}`;
  const exitActionCode = `V2X${personCode}`;
  const email = 'operator@example.local';
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
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ now: receivedAt }]),
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
        findFirst: jest.fn().mockResolvedValue(null),
      },
      mailJob: {
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
        findFirstOrThrow: jest.fn().mockResolvedValue({
          id: mailJobId,
          toEmail: 'taro.yamada@example.local',
          subject: 'Office Aからのお知らせ',
          body: 'mail body',
          retryCount: 0,
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      scanRequestIdempotency: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue(undefined),
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

  it.each(['trial', 'active'])(
    'POST /api/scan-events should create scan_event and queued mail_job for %s subscriptions',
    async (status) => {
      mockAuthenticatedUser();
      mockSubscription(status);
      mockLocation();
      prisma.personMapping.findFirst.mockResolvedValue({
        id: personMappingId,
        personCode,
        personName: '山田 太郎',
        email: 'taro.yamada@example.local',
      });
      prisma.scanEvent.create.mockResolvedValue({ id: scanEventId });
      prisma.mailJob.create.mockResolvedValue({
        id: mailJobId,
        status: 'waiting',
        createdAt: receivedAt,
        cancelUntil: new Date(receivedAt.getTime() + 10_000),
        sendNotBefore: new Date(receivedAt.getTime() + 10_000),
      });

      await request(app.getHttpServer())
        .post('/api/scan-events')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({
          location_id: locationId,
          scan_code: entryActionCode,
        })
        .expect(201)
        .expect({
          scan_event_id: scanEventId,
          mail_job_id: mailJobId,
          mail_subject: 'Office Aからのお知らせ',
          person_code: personCode,
          action: 'entry',
          action_source: 'person_action_code',
          status: 'waiting',
          effective_status: 'active',
          mail_status: 'waiting',
          can_cancel: true,
          cancel_until: '2026-06-22T03:04:15.000Z',
          server_time: '2026-06-22T03:04:05.000Z',
          canceled_at: null,
          retry_count: 0,
          scheduled_at: null,
          error_message: null,
          deduplicated: false,
        });

      expect(prisma.location.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: locationId,
            tenantId,
            status: { notIn: ['pending_delete', 'purged'] },
            operatorLocationAssignments: {
              some: { tenantId, operatorId: userId },
            },
          },
        }),
      );
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        'SELECT CURRENT_TIMESTAMP AS now',
      );
      expect(prisma.personMapping.findFirst).toHaveBeenCalledWith({
        where: {
          tenantId,
          locationId,
          personCode,
          status: 'active',
        },
        select: {
          id: true,
          personCode: true,
          personName: true,
          email: true,
        },
      });
      expect(prisma.scanEvent.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          locationId,
          personMappingId,
          personCodeSnapshot: personCode,
          scanCode: personCode,
          scanType: 'entry',
          action: 'entry',
          actionSource: 'person_action_code',
          rawPayload: JSON.stringify({
            location_id: locationId,
            version: 'V2',
            person_code: personCode,
            action: 'entry',
          }),
          receivedAt,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      expect(prisma.mailJob.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          locationId,
          personMappingId,
          scanEventId,
          tenantNameSnapshot: 'Poolduck Tenant',
          locationNameSnapshot: 'Office A',
          personNameSnapshot: '山田 太郎',
          personCodeSnapshot: personCode,
          actionSnapshot: 'entry',
          contextSnapshotSource: 'scan_relation',
          toEmail: 'taro.yamada@example.local',
          subject: 'Office Aからのお知らせ',
          body: 'Poolduck Tenant，Office Aからのお知らせ：山田 太郎　さんは　20260622030405　に入室しました。',
          templateKey: 'scan_entry_notice_v1',
          status: 'waiting',
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
          cancelUntil: true,
          sendNotBefore: true,
        },
      });
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        `${tenantId}:${locationId}:${personCode}`,
      );
    },
  );

  it('creates an exit event and persists the same action in the mail snapshot and body', async () => {
    mockAuthenticatedUser();
    mockSubscription('active');
    mockLocation();
    prisma.personMapping.findFirst.mockResolvedValue({
      id: personMappingId,
      personCode,
      personName: '山田 太郎',
      email: 'taro.yamada@example.local',
    });
    prisma.scanEvent.create.mockResolvedValue({ id: scanEventId });
    prisma.mailJob.create.mockResolvedValue({ id: mailJobId });

    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .set('Idempotency-Key', 'exit-test-key-123')
      .send({ location_id: locationId, scan_code: exitActionCode })
      .expect(201);

    expect(response.body).toMatchObject({
      person_code: personCode,
      action: 'exit',
      action_source: 'person_action_code',
      deduplicated: false,
    });
    expect(prisma.scanEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scanType: 'exit',
        action: 'exit',
        actionSource: 'person_action_code',
      }),
      select: { id: true },
    });
    expect(prisma.mailJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionSnapshot: 'exit',
        body: 'Poolduck Tenant，Office Aからのお知らせ：山田 太郎　さんは　20260622030405　に退室しました。',
        templateKey: 'scan_exit_notice_v1',
      }),
      select: {
        id: true,
        status: true,
        createdAt: true,
        cancelUntil: true,
        sendNotBefore: true,
      },
    });
    expect(prisma.scanRequestIdempotency.upsert).toHaveBeenCalledWith({
      where: {
        tenantId_route_keyHash: {
          tenantId,
          route: 'POST:/api/scan-events',
          keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
      create: expect.objectContaining({
        tenantId,
        route: 'POST:/api/scan-events',
        keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        scanEventId,
        mailJobId,
        expiresAt: new Date('2026-06-23T03:04:05.000Z'),
      }),
      update: expect.objectContaining({
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        scanEventId,
        mailJobId,
        expiresAt: new Date('2026-06-23T03:04:05.000Z'),
        createdAt: receivedAt,
      }),
    });
  });

  it.each([
    ['bare person code', personCode],
    ['legacy PD1 code', `PD1|ENTRY|${personCode}`],
    ['unknown version', `V3E${personCode}`],
    ['unknown action', `V2A${personCode}`],
    ['lowercase token', `V2e${personCode}`],
    ['truncated code', `V2E${personCode.slice(0, -1)}`],
    ['extra character', `V2E${personCode}A`],
    ['leading space', ` V2E${personCode}`],
    ['trailing space', `V2E${personCode} `],
    ['internal space', `V2E${personCode.slice(0, 6)} ${personCode.slice(6)}`],
    ['device prefix', `SCANV2E${personCode}`],
    ['repeated suffix', `V2E${personCode}\r\n\r\n`],
    ['legacy/new concatenation', `PD1|ENTRY|${personCode}V2E${personCode}`],
  ])(
    'rejects %s without creating a scan event',
    async (_caseName, scanCode) => {
      mockAuthenticatedUser();

      const response = await request(app.getHttpServer())
        .post('/api/scan-events')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({ location_id: locationId, scan_code: scanCode })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'ACTION_CODE_INVALID' });
      expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
      expect(prisma.scanEvent.create).not.toHaveBeenCalled();
      expect(prisma.mailJob.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'scan.action_code.denied',
          result: 'denied',
        }),
      });
    },
  );

  it.each(['\r', '\n', '\r\n'])(
    'accepts one approved %j submit suffix',
    async (suffix) => {
      mockAuthenticatedUser();
      mockSubscription('active');
      mockLocation();
      prisma.personMapping.findFirst.mockResolvedValue({
        id: personMappingId,
        personCode,
        personName: '山田 太郎',
        email: 'taro.yamada@example.local',
      });
      prisma.scanEvent.create.mockResolvedValue({ id: scanEventId });
      prisma.mailJob.create.mockResolvedValue({
        id: mailJobId,
        status: 'waiting',
        createdAt: receivedAt,
        cancelUntil: new Date(receivedAt.getTime() + 10_000),
        sendNotBefore: new Date(receivedAt.getTime() + 10_000),
      });

      const response = await request(app.getHttpServer())
        .post('/api/scan-events')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({ location_id: locationId, scan_code: `${entryActionCode}${suffix}` })
        .expect(201);

      expect(response.body).toMatchObject({
        person_code: personCode,
        action: 'entry',
        action_source: 'person_action_code',
      });
    },
  );

  it('rejects malformed idempotency keys without misclassifying the action code', async () => {
    mockAuthenticatedUser();

    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .set('Idempotency-Key', 'short')
      .send({ location_id: locationId, scan_code: entryActionCode })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_INVALID' });
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'scan.idempotency_key.denied',
        result: 'denied',
      }),
    });
  });

  it('rejects the opposite action for the same person inside the 10 second window', async () => {
    mockAuthenticatedUser();
    mockSubscription('active');
    mockLocation();
    prisma.personMapping.findFirst.mockResolvedValue({
      id: personMappingId,
      personCode,
      personName: '山田 太郎',
      email: 'taro.yamada@example.local',
    });
    prisma.scanEvent.findFirst.mockResolvedValue({
      id: scanEventId,
      personCodeSnapshot: personCode,
      action: 'entry',
      actionSource: 'person_action_code',
      mailJobs: [
        {
          id: mailJobId,
          subject: 'Office Aからのお知らせ',
          status: 'sent',
          retryCount: 0,
          scheduledAt: null,
          errorMessage: null,
        },
      ],
    });

    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({ location_id: locationId, scan_code: exitActionCode })
      .expect(409);

    expect(response.body).toMatchObject({
      code: 'SCAN_ACTION_CONFLICT',
      scan_event_id: scanEventId,
      existing_action: 'entry',
    });
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
    expect(prisma.mailJob.create).not.toHaveBeenCalled();
  });

  it('replays a 24-hour idempotency result before subscription gating and never resends it', async () => {
    mockAuthenticatedUser();
    mockLocation();
    const requestFingerprint = sha256(
      JSON.stringify({
        location_id: locationId,
        person_code: personCode,
        action: 'entry',
      }),
    );
    prisma.scanRequestIdempotency.findFirst.mockResolvedValue({
      requestFingerprint,
      mailJobId,
    });
    prisma.mailJob.findFirst.mockResolvedValue({
      id: mailJobId,
      subject: 'Office Aからのお知らせ',
      status: 'sent',
      retryCount: 0,
      scheduledAt: null,
      errorMessage: null,
      actionSnapshot: 'entry',
      scanEvent: {
        id: scanEventId,
        personCodeSnapshot: personCode,
        action: 'entry',
        actionSource: 'person_action_code',
      },
    });

    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .set('Idempotency-Key', 'replay-test-key-123')
      .send({ location_id: locationId, scan_code: entryActionCode })
      .expect(201);

    expect(response.body).toMatchObject({
      scan_event_id: scanEventId,
      mail_job_id: mailJobId,
      action: 'entry',
      deduplicated: true,
    });
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    expect(prisma.mailJob.updateMany).not.toHaveBeenCalled();
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key with a different action fingerprint', async () => {
    mockAuthenticatedUser();
    mockLocation();
    prisma.scanRequestIdempotency.findFirst.mockResolvedValue({
      requestFingerprint: sha256('different request'),
      mailJobId,
    });

    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .set('Idempotency-Key', 'conflict-test-key-123')
      .send({ location_id: locationId, scan_code: entryActionCode })
      .expect(409);

    expect(response.body).toMatchObject({
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });
    expect(prisma.subscription.findUnique).not.toHaveBeenCalled();
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
  });

  it('blocks inactive assigned locations before idempotency replay', async () => {
    mockAuthenticatedUser();
    prisma.location.findFirst.mockResolvedValue({
      id: locationId,
      status: 'inactive',
    });

    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .set('Idempotency-Key', 'inactive-location-key')
      .send({ location_id: locationId, scan_code: entryActionCode })
      .expect(404);

    expect(response.body).toMatchObject({ code: 'LOCATION_INACTIVE' });
    expect(prisma.scanRequestIdempotency.findFirst).not.toHaveBeenCalled();
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
  });

  it('POST /api/scan-events should reject an unmapped code without persisting business records', async () => {
    mockAuthenticatedUser();
    mockSubscription('active');
    mockLocation();
    prisma.personMapping.findFirst.mockResolvedValue(null);
    const response = await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({
        location_id: locationId,
        scan_code: `V2X${unmappedPersonCode}`,
      })
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'SCAN_CODE_NOT_MAPPED',
      message: 'person_code未在当前 location 找到映射邮箱',
    });
    expect(response.body).not.toHaveProperty('scan_event_id');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
    expect(prisma.mailJob.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns the existing task for a duplicate scan inside the 10 second window', async () => {
    mockAuthenticatedUser();
    mockSubscription('active');
    mockLocation();
    prisma.personMapping.findFirst.mockResolvedValue({
      id: personMappingId,
      personCode,
      personName: '山田 太郎',
      email: 'taro.yamada@example.local',
    });
    prisma.scanEvent.findFirst.mockResolvedValue({
      id: scanEventId,
      personCodeSnapshot: personCode,
      action: 'entry',
      actionSource: 'person_action_code',
      mailJobs: [
        {
          id: mailJobId,
          subject: 'Office Aからのお知らせ',
          status: 'queued',
          retryCount: 0,
          scheduledAt: null,
          errorMessage: null,
        },
      ],
    });

    await request(app.getHttpServer())
      .post('/api/scan-events')
      .set('Authorization', `Bearer ${accessToken()}`)
      .send({ location_id: locationId, scan_code: entryActionCode })
      .expect(201)
      .expect({
        scan_event_id: scanEventId,
        mail_job_id: mailJobId,
        mail_subject: 'Office Aからのお知らせ',
        person_code: personCode,
        action: 'entry',
        action_source: 'person_action_code',
        status: 'queued',
        effective_status: 'active',
        mail_status: 'queued',
        can_cancel: false,
        cancel_until: null,
        server_time: '2026-06-22T03:04:05.000Z',
        canceled_at: null,
        retry_count: 0,
        scheduled_at: null,
        error_message: null,
        deduplicated: true,
      });

    expect(prisma.scanEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          locationId,
          personMappingId,
          receivedAt: { gt: new Date('2026-06-22T03:03:55.000Z') },
        }),
      }),
    );
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
    expect(prisma.mailJob.create).not.toHaveBeenCalled();
  });

  it.each(['expired', 'suspended'])(
    'POST /api/scan-events should reject %s subscriptions before creating scan_event or mail_job',
    async (status) => {
      mockAuthenticatedUser();
      mockSubscription(status);
      mockLocation();

      const response = await request(app.getHttpServer())
        .post('/api/scan-events')
        .set('Authorization', `Bearer ${accessToken()}`)
        .send({
          location_id: locationId,
          scan_code: entryActionCode,
        })
        .expect(403);

      expect(response.body).toMatchObject({
        code: 'SUBSCRIPTION_NOT_SENDABLE',
      });
      expect(prisma.location.findFirst).toHaveBeenCalled();
      expect(prisma.scanEvent.create).not.toHaveBeenCalled();
      expect(prisma.mailJob.create).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'subscription.scan.denied',
          result: 'denied',
          metadataJson: { status },
        }),
      });
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
        scan_code: entryActionCode,
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
        scan_code: entryActionCode,
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
        scan_code: entryActionCode,
      })
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: '未认证',
    });
    expect(prisma.scanEvent.create).not.toHaveBeenCalled();
    expect(prisma.mailJob.create).not.toHaveBeenCalled();
  });

  it('POST /api/scan-events/:id/cancel atomically cancels a waiting job', async () => {
    mockAuthenticatedUser();
    const canceledAt = new Date('2026-06-22T03:04:08.000Z');
    prisma.scanEvent.findFirst
      .mockResolvedValueOnce({
        id: scanEventId,
        locationId,
        canceledAt: null,
        mailJobs: [{ id: mailJobId, status: 'waiting', cancelUntil: new Date('2026-06-22T03:04:15.000Z') }],
      })
      .mockResolvedValueOnce({
        canceledAt,
        mailJobs: [{ id: mailJobId, status: 'canceled', cancelUntil: new Date('2026-06-22T03:04:15.000Z') }],
      });

    const response = await request(app.getHttpServer())
      .post(`/api/scan-events/${scanEventId}/cancel`)
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(200);

    expect(response.body).toMatchObject({
      scan_event_id: scanEventId,
      mail_job_id: mailJobId,
      effective_status: 'canceled',
      mail_status: 'canceled',
      canceled_at: canceledAt.toISOString(),
    });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(`date_trunc('milliseconds', CURRENT_TIMESTAMP) < "cancel_until"`),
      mailJobId,
      tenantId,
      locationId,
      scanEventId,
    );
  });

  it('POST /api/scan-events/:id/cancel is idempotent after cancellation', async () => {
    mockAuthenticatedUser();
    const canceledAt = new Date('2026-06-22T03:04:07.000Z');
    prisma.scanEvent.findFirst.mockResolvedValue({
      id: scanEventId,
      locationId,
      canceledAt,
      mailJobs: [{ id: mailJobId, status: 'canceled', cancelUntil: new Date('2026-06-22T03:04:15.000Z') }],
    });

    const response = await request(app.getHttpServer())
      .post(`/api/scan-events/${scanEventId}/cancel`)
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(200);

    expect(response.body.canceled_at).toBe(canceledAt.toISOString());
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('POST /api/scan-events/:id/cancel returns one not-found shape outside the authorized location', async () => {
    mockAuthenticatedUser();
    prisma.scanEvent.findFirst.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post(`/api/scan-events/${scanEventId}/cancel`)
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(404);

    expect(response.body).toMatchObject({ code: 'SCAN_EVENT_NOT_FOUND' });
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
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

  function mockLocation() {
    prisma.location.findFirst.mockResolvedValue({
      id: locationId,
      name: 'Office A',
      status: 'active',
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
      role: 'operator',
    });
  }

  function sha256(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
});
