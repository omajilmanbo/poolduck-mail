import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Tenant-scoped history APIs', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: {
    user: { findFirst: jest.Mock };
    location: { findFirst: jest.Mock };
    scanEvent: { findMany: jest.Mock; findFirst: jest.Mock };
    mailJob: { findMany: jest.Mock; findFirst: jest.Mock };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const userId = '33333333-3333-4333-8333-333333333333';
  const locationId = '44444444-4444-4444-8444-444444444444';
  const scanEventId = '55555555-5555-4555-8555-555555555555';
  const otherScanEventId = '55555556-5556-4556-8556-555555555556';
  const mailJobId = '66666666-6666-4666-8666-666666666666';
  const personCode = '01K0ABC60001';
  const createdAt = new Date('2026-07-20T01:02:03.000Z');

  beforeAll(() => {
    process.env.JWT_SECRET = 'history-spec-secret';
  });

  beforeEach(async () => {
    prisma = {
      user: { findFirst: jest.fn() },
      location: { findFirst: jest.fn() },
      scanEvent: { findMany: jest.fn(), findFirst: jest.fn() },
      mailJob: { findMany: jest.fn(), findFirst: jest.fn() },
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
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      tenantId,
      email: 'operator@example.local',
      role: 'operator',
      status: 'active',
    });
  });

  afterEach(async () => app.close());

  it('returns an empty scan history page', async () => {
    prisma.scanEvent.findMany.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/api/scan-events')
      .set('Authorization', `Bearer ${token()}`)
      .expect(200)
      .expect({ items: [], next_cursor: null });

    expect(prisma.scanEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          location: {
            is: {
              tenantId,
              operatorLocationAssignments: {
                some: { tenantId, operatorId: userId },
              },
            },
          },
        }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 26,
      }),
    );
  });

  it('combines location, status, date, limit and stable cursor pagination', async () => {
    prisma.location.findFirst.mockResolvedValue({
      id: locationId,
      locationCode: 'A1B2C3D4',
      status: 'active',
    });
    prisma.scanEvent.findMany.mockResolvedValue([
      scanRow(scanEventId, 'queued'),
      scanRow(otherScanEventId, 'queued'),
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/scan-events')
      .query({
        location_id: locationId,
        status: 'queued',
        created_from: '2026-07-01T00:00:00.000Z',
        created_to: '2026-07-31T23:59:59.000Z',
        limit: 1,
      })
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);

    expect(response.body.items).toHaveLength(1);
    expect(response.body.next_cursor).toEqual(expect.any(String));
    expect(prisma.scanEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          locationId,
          mailJobs: { some: { status: 'queued' } },
          createdAt: {
            gte: new Date('2026-07-01T00:00:00.000Z'),
            lte: new Date('2026-07-31T23:59:59.000Z'),
          },
        }),
        take: 2,
      }),
    );
  });

  it('returns unmapped scan history without inventing a mail job', async () => {
    prisma.scanEvent.findFirst.mockResolvedValue({
      ...scanRow(scanEventId, 'unmapped'),
      scanType: 'unmapped',
      mailJobs: [],
    });

    const response = await request(app.getHttpServer())
      .get(`/api/scan-events/${scanEventId}`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);

    expect(response.body).toMatchObject({
      scan_event_id: scanEventId,
      status: 'unmapped',
      mail_job: null,
    });
  });

  it('returns legacy scans as unknown without inferring an action', async () => {
    prisma.scanEvent.findFirst.mockResolvedValue({
      ...scanRow(scanEventId, 'sent'),
      scanType: 'barcode',
      action: 'unknown',
      actionSource: 'legacy_unknown',
      mailJobs: [{
        ...scanRow(scanEventId, 'sent').mailJobs[0],
        actionSnapshot: 'unknown',
      }],
    });

    const response = await request(app.getHttpServer())
      .get(`/api/scan-events/${scanEventId}`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);

    expect(response.body).toMatchObject({
      action: 'unknown',
      action_source: 'legacy_unknown',
      mail_job: { action: 'unknown' },
    });
  });

  it('does not reveal cross-tenant scan event IDs', async () => {
    prisma.scanEvent.findFirst.mockResolvedValue(null);
    const response = await request(app.getHttpServer())
      .get(`/api/scan-events/${scanEventId}`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(404);
    expect(response.body).toMatchObject({ code: 'SCAN_EVENT_NOT_FOUND' });
    expect(prisma.scanEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: scanEventId,
          tenantId,
          location: expect.any(Object),
        }),
      }),
    );
  });

  it('returns mail history with safe fields and masks uncontrolled provider errors', async () => {
    prisma.mailJob.findFirst.mockResolvedValue({
      id: mailJobId,
      status: 'failed',
      createdAt,
      sentAt: null,
      errorMessage: 'delivery to private.person@example.com failed with secret=abc',
      retryCount: 0,
      scheduledAt: null,
      locationId,
      location: { locationCode: 'A1B2C3D4' },
      tenantNameSnapshot: 'Tenant at send time',
      locationNameSnapshot: 'Office A at send time',
      personNameSnapshot: 'Person at send time',
      personCodeSnapshot: personCode,
      actionSnapshot: 'exit',
      contextSnapshotSource: 'scan_relation',
      toEmail: 'private.person@example.com',
      body: 'private mail body',
      scanEvent: {
        id: scanEventId,
        scanCode: personCode,
        action: 'exit',
        actionSource: 'person_action_code',
        receivedAt: createdAt,
        location: { name: 'Office renamed later' },
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/api/mail-jobs/${mailJobId}`)
      .set('Authorization', `Bearer ${token()}`)
      .expect(200);

    expect(response.body).toMatchObject({
      mail_job_id: mailJobId,
      action: 'exit',
      status: 'failed',
      error_message: '邮件发送失败',
      context: {
        tenant_name: 'Tenant at send time',
        location_name: 'Office A at send time',
        person_name: 'Person at send time',
        person_code: personCode,
        snapshot_source: 'scan_relation',
      },
      scan_event: {
        location_name: 'Office A at send time',
        person_code: personCode,
        action: 'exit',
        action_source: 'person_action_code',
      },
    });
    expect(JSON.stringify(response.body)).not.toContain('private.person@example.com');
    expect(JSON.stringify(response.body)).not.toContain('private mail body');
    expect(JSON.stringify(response.body)).not.toContain('secret=abc');
    expect(prisma.mailJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: mailJobId,
          tenantId,
          location: {
            is: {
              tenantId,
              operatorLocationAssignments: {
                some: { tenantId, operatorId: userId },
              },
            },
          },
        }),
      }),
    );
  });

  it('rejects invalid locations, cursors and unauthenticated reads', async () => {
    prisma.location.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get('/api/mail-jobs')
      .query({ location_id: locationId })
      .set('Authorization', `Bearer ${token()}`)
      .expect(404);
    const cursorResponse = await request(app.getHttpServer())
      .get('/api/scan-events')
      .query({ cursor: 'not-a-cursor' })
      .set('Authorization', `Bearer ${token()}`)
      .expect(400);
    expect(cursorResponse.body).toMatchObject({ code: 'INVALID_CURSOR' });
    await request(app.getHttpServer()).get('/api/scan-events').expect(401);
  });

  function scanRow(id: string, status: string) {
    return {
      id,
      locationId,
      personCodeSnapshot: personCode,
      scanCode: personCode,
      scanType: 'entry',
      action: 'entry',
      actionSource: 'person_action_code',
      receivedAt: createdAt,
      createdAt,
      location: { locationCode: 'A1B2C3D4', name: 'Office A' },
      mailJobs: [
        {
          id: mailJobId,
          status,
          sentAt: null,
          errorMessage: null,
          locationNameSnapshot: 'Office A at send time',
          personNameSnapshot: 'Person at send time',
          personCodeSnapshot: personCode,
          actionSnapshot: 'entry',
        },
      ],
    };
  }

  function token() {
    return jwtService.sign({
      sub: userId,
      user_id: userId,
      tenant_id: tenantId,
      role: 'operator',
    });
  }
});
