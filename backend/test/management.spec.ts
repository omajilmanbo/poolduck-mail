import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LocationCodeGenerator } from '../src/locations/location-code.generator';
import { PersonCodeGenerator } from '../src/locations/person-code.generator';
import { PrismaService } from '../src/prisma.service';

describe('Location and person mapping management', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let personCodeGenerator: PersonCodeGenerator;
  let locationCodeGenerator: LocationCodeGenerator;
  let prisma: {
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
    user: { findFirst: jest.Mock };
    location: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    locationLegacyIdentifier: { findFirst: jest.Mock };
    personMapping: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    mailJob: { updateMany: jest.Mock };
    auditLog: { create: jest.Mock };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const userId = '33333333-3333-4333-8333-333333333333';
  const locationId = '44444444-4444-4444-8444-444444444444';
  const personId = '55555555-5555-4555-8555-555555555555';
  const personCode = '01K0ABC30001';

  beforeAll(() => {
    process.env.JWT_SECRET = 'management-spec-secret';
  });

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof prisma) => unknown) => callback(prisma)),
      $queryRaw: jest.fn().mockResolvedValue([{ now: new Date('2026-07-28T00:00:00.000Z') }]),
      user: { findFirst: jest.fn() },
      location: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      locationLegacyIdentifier: { findFirst: jest.fn().mockResolvedValue(null) },
      personMapping: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      mailJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleFixture.createNestApplication();
    jwtService = moduleFixture.get(JwtService);
    personCodeGenerator = moduleFixture.get(PersonCodeGenerator);
    locationCodeGenerator = moduleFixture.get(LocationCodeGenerator);
    jest.spyOn(personCodeGenerator, 'generate').mockReturnValue(personCode);
    jest.spyOn(locationCodeGenerator, 'generate').mockReturnValue('ABCD1234');
    await app.init();
  });

  afterEach(async () => app.close());

  it.each(['operator', 'tenant_manager'])('allows %s to create a mapping in an active tenant location', async (role) => {
    authenticate(role);
    prisma.location.findFirst.mockResolvedValue({ id: locationId, locationCode: 'ABCD1234', status: 'active' });
    prisma.personMapping.create.mockImplementation(({ data }) =>
      Promise.resolve(personRow('active', data.personCode)),
    );

    const response = await request(app.getHttpServer())
      .post(`/api/locations/${locationId}/people`)
      .set('Authorization', `Bearer ${token(role)}`)
      .send({ person_name: 'Local Person', email: 'Person@Example.Local' })
      .expect(201);
    expect(response.body).toEqual(expect.objectContaining({
        person_id: personCode,
        person_code: personCode,
        scan_code: personCode,
        location_id: 'ABCD1234',
        email: 'person@example.local',
        email_masked: 'p***n@example.local',
        is_active: true,
    }));

    expect(prisma.personMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          locationId,
          personCode,
          scanCode: personCode,
          email: 'person@example.local',
        }),
      }),
    );
  });

  it('rejects invalid email, cross-tenant location and location moves', async () => {
    authenticate('operator');
    await request(app.getHttpServer())
      .post(`/api/locations/${locationId}/people`)
      .set('Authorization', `Bearer ${token('operator')}`)
      .send({ person_name: 'Person', email: 'invalid' })
      .expect(400);

    prisma.location.findFirst.mockResolvedValue(null);
    await request(app.getHttpServer())
      .post(`/api/locations/${locationId}/people`)
      .set('Authorization', `Bearer ${token('operator')}`)
      .send({ person_name: 'Person', email: 'person@example.local' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/locations/${locationId}/people`)
      .set('Authorization', `Bearer ${token('operator')}`)
      .send({
        scan_code: 'CLIENT-OVERRIDE',
        person_name: 'Person',
        email: 'person@example.local',
      })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/locations/${locationId}/people/${personId}`)
      .set('Authorization', `Bearer ${token('operator')}`)
      .send({ location_id: '66666666-6666-4666-8666-666666666666' })
      .expect(400);
  });

  it('soft-deactivates a mapping and preserves its identity', async () => {
    authenticate('operator');
    prisma.location.findFirst.mockResolvedValue({ id: locationId, locationCode: 'ABCD1234', status: 'active' });
    prisma.personMapping.findFirst.mockResolvedValue({ id: personId, personCode });
    prisma.personMapping.update.mockResolvedValue(personRow('inactive'));

    const response = await request(app.getHttpServer())
      .delete(`/api/locations/${locationId}/people/${personCode}`)
      .set('Authorization', `Bearer ${token('operator')}`)
      .expect(200);
    expect(response.body).toEqual(expect.objectContaining({
      person_id: personCode,
      person_code: personCode,
      is_active: false,
    }));

    expect(prisma.personMapping.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: personId }, data: { status: 'inactive' } }),
    );
  });

  it('retries person_code collisions and never records the collided code in audit metadata', async () => {
    authenticate('operator');
    prisma.location.findFirst.mockResolvedValue({ id: locationId, locationCode: 'ABCD1234', status: 'active' });
    jest
      .spyOn(personCodeGenerator, 'generate')
      .mockReturnValueOnce('01K0ABC30002')
      .mockReturnValueOnce(personCode);
    prisma.personMapping.create
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockImplementationOnce(({ data }) =>
        Promise.resolve(personRow('active', data.personCode)),
      );

    const response = await request(app.getHttpServer())
      .post(`/api/locations/${locationId}/people`)
      .set('Authorization', `Bearer ${token('operator')}`)
      .send({ person_name: 'Local Person', email: 'person@example.local' })
      .expect(201);

    expect(response.body.person_code).toBe(personCode);
    expect(prisma.personMapping.create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(prisma.auditLog.create.mock.calls)).not.toContain(
      '01K0ABC30002',
    );
  });

  it('allows only tenant_manager to create and deactivate a tenant location', async () => {
    authenticate('operator');
    await request(app.getHttpServer())
      .post('/api/locations')
      .set('Authorization', `Bearer ${token('operator')}`)
      .send({ location_name: 'Office B' })
      .expect(403);

    authenticate('tenant_manager');
    prisma.location.findFirst.mockResolvedValueOnce(null);
    prisma.location.create.mockResolvedValue(locationRow('active'));
    await request(app.getHttpServer())
      .post('/api/locations')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({ location_name: 'Office B' })
      .expect(201);

    prisma.location.findFirst.mockResolvedValue({ id: locationId, locationCode: 'ABCD1234', status: 'active' });
    prisma.location.update.mockResolvedValue(locationRow('inactive'));
    const response = await request(app.getHttpServer())
      .delete(`/api/locations/${locationId}`)
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .expect(200);
    expect(response.body).toEqual(expect.objectContaining({ location_id: 'ABCD1234', type: 'location', is_active: false }));

    expect(prisma.mailJob.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        status: 'queued',
        scanEvent: { is: { locationId } },
      },
      data: { status: 'failed', errorMessage: 'LOCATION_INACTIVE' },
    });
  });

  it('rejects client-supplied location IDs/types and same-tenant duplicate names', async () => {
    authenticate('tenant_manager');
    await request(app.getHttpServer())
      .post('/api/locations')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({
        location_name: 'Office B',
        location_code: 'FORGED01',
        type: 'office',
      })
      .expect(400);

    prisma.location.findFirst.mockResolvedValue({ id: locationId });
    const response = await request(app.getHttpServer())
      .post('/api/locations')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({ location_name: ' office b ' })
      .expect(409);
    expect(response.body).toMatchObject({ code: 'LOCATION_NAME_CONFLICT' });
    expect(prisma.location.create).not.toHaveBeenCalled();
  });

  it('retries location ID collisions five times without accepting an override', async () => {
    authenticate('tenant_manager');
    prisma.location.findFirst.mockResolvedValue(null);
    prisma.location.create.mockRejectedValue({ code: 'P2002' });

    const response = await request(app.getHttpServer())
      .post('/api/locations')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({ location_name: 'Office B' })
      .expect(503);

    expect(response.body).toMatchObject({
      code: 'LOCATION_CODE_GENERATION_EXHAUSTED',
    });
    expect(prisma.location.create).toHaveBeenCalledTimes(5);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'location.code_generation_failed',
        metadataJson: { collision_retries: 5 },
      }),
    });
  });

  it('reactivates inactive locations and people while preserving internal IDs', async () => {
    authenticate('tenant_manager');
    prisma.location.findFirst.mockResolvedValue({
      id: locationId,
      locationCode: 'ABCD1234',
      status: 'inactive',
    });
    prisma.location.update.mockResolvedValue(locationRow('active'));

    const locationResponse = await request(app.getHttpServer())
      .post('/api/locations/ABCD1234/reactivate')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .expect(201);
    expect(locationResponse.body).toEqual(
      expect.objectContaining({
        location_id: 'ABCD1234',
        is_active: true,
      }),
    );

    prisma.location.findFirst.mockResolvedValue({
      id: locationId,
      locationCode: 'ABCD1234',
      status: 'active',
    });
    prisma.personMapping.findFirst.mockResolvedValue({
      id: personId,
      personCode,
      status: 'inactive',
    });
    prisma.personMapping.update.mockResolvedValue(personRow('active'));

    const personResponse = await request(app.getHttpServer())
      .post(`/api/locations/ABCD1234/people/${personCode}/reactivate`)
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .expect(201);
    expect(personResponse.body).toEqual(
      expect.objectContaining({
        person_id: personCode,
        location_id: 'ABCD1234',
        is_active: true,
      }),
    );
  });

  it('schedules and restores a person deletion within the 14-day window', async () => {
    authenticate('operator');
    const deletedAt = new Date('2026-07-28T00:00:00.000Z');
    const purgeAfter = new Date('2026-08-11T00:00:00.000Z');
    prisma.location.findFirst.mockResolvedValue({
      id: locationId,
      locationCode: 'ABCD1234',
      status: 'active',
    });
    prisma.personMapping.findFirst
      .mockResolvedValueOnce({
        id: personId,
        personCode,
        status: 'inactive',
      })
      .mockResolvedValueOnce({
        ...personRow('pending_delete'),
        id: personId,
        personCode,
        deletedFromStatus: 'inactive',
        purgeAfter,
      });
    prisma.personMapping.update
      .mockResolvedValueOnce({
        ...personRow('pending_delete'),
        deletedAt,
        purgeAfter,
      });

    const scheduled = await request(app.getHttpServer())
      .post(`/api/locations/ABCD1234/people/${personCode}/delete`)
      .set('Authorization', `Bearer ${token('operator')}`)
      .expect(201);
    expect(scheduled.body).toMatchObject({
      person_id: personCode,
      is_active: false,
      deletion_status: 'scheduled',
      deleted_at: deletedAt.toISOString(),
      purge_after: purgeAfter.toISOString(),
    });
    expect(prisma.personMapping.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'pending_delete',
          deletedFromStatus: 'inactive',
          deletedAt,
          purgeAfter,
        }),
      }),
    );

    const restored = await request(app.getHttpServer())
      .post(`/api/locations/ABCD1234/people/${personCode}/restore`)
      .set('Authorization', `Bearer ${token('operator')}`)
      .expect(201);
    expect(restored.body).toMatchObject({
      person_id: personCode,
      is_active: false,
      deletion_status: null,
    });
    expect(prisma.personMapping.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending_delete',
          purgeAfter: { gt: deletedAt },
        }),
        data: {
          status: 'inactive',
          deletedAt: null,
          purgeAfter: null,
          deletedFromStatus: null,
        },
      }),
    );
  });

  it('allows only tenant_manager to schedule a location deletion and rejects restore at the deadline', async () => {
    authenticate('operator');
    await request(app.getHttpServer())
      .post('/api/locations/ABCD1234/delete')
      .set('Authorization', `Bearer ${token('operator')}`)
      .expect(403);

    authenticate('tenant_manager');
    const deletedAt = new Date('2026-07-28T00:00:00.000Z');
    const purgeAfter = new Date('2026-08-11T00:00:00.000Z');
    prisma.location.findFirst
      .mockResolvedValueOnce({
        id: locationId,
        locationCode: 'ABCD1234',
        status: 'active',
      })
      .mockResolvedValueOnce({
        id: locationId,
        locationCode: 'ABCD1234',
        status: 'pending_delete',
        deletedFromStatus: 'active',
        purgeAfter: deletedAt,
      });
    prisma.location.update.mockResolvedValue({
      ...locationRow('pending_delete'),
      deletedAt,
      purgeAfter,
    });

    const scheduled = await request(app.getHttpServer())
      .post('/api/locations/ABCD1234/delete')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .expect(201);
    expect(scheduled.body).toMatchObject({
      location_id: 'ABCD1234',
      deletion_status: 'scheduled',
      purge_after: purgeAfter.toISOString(),
    });
    expect(prisma.mailJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'failed',
          errorMessage: 'LOCATION_PENDING_DELETION',
        },
      }),
    );

    const expired = await request(app.getHttpServer())
      .post('/api/locations/ABCD1234/restore')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .expect(409);
    expect(expired.body).toMatchObject({
      code: 'DELETION_RESTORE_EXPIRED',
    });
  });

  function authenticate(role: string) {
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      tenantId,
      email: `${role}@example.local`,
      role,
      status: 'active',
    });
  }

  function token(role: string) {
    return jwtService.sign({ sub: userId, user_id: userId, tenant_id: tenantId, role });
  }

  function personRow(status = 'active', code = personCode) {
    return {
      id: personId,
      personCode: code,
      locationId,
      personName: 'Local Person',
      email: 'person@example.local',
      status,
    };
  }

  function locationRow(status: string) {
    return {
      id: locationId,
      locationCode: 'ABCD1234',
      name: 'Office B',
      type: 'location',
      status,
    };
  }
});
