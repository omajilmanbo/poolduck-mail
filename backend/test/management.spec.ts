import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PersonCodeGenerator } from '../src/locations/person-code.generator';
import { PrismaService } from '../src/prisma.service';

describe('Location and person mapping management', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let personCodeGenerator: PersonCodeGenerator;
  let prisma: {
    $transaction: jest.Mock;
    user: { findFirst: jest.Mock };
    location: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    personMapping: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
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
      user: { findFirst: jest.fn() },
      location: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      personMapping: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
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
    jest.spyOn(personCodeGenerator, 'generate').mockReturnValue(personCode);
    await app.init();
  });

  afterEach(async () => app.close());

  it.each(['operator', 'tenant_manager'])('allows %s to create a mapping in an active tenant location', async (role) => {
    authenticate(role);
    prisma.location.findFirst.mockResolvedValue({ id: locationId, status: 'active' });
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
        location_id: locationId,
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
    prisma.location.findFirst.mockResolvedValue({ id: locationId, status: 'active' });
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
    prisma.location.findFirst.mockResolvedValue({ id: locationId, status: 'active' });
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
      .send({ location_code: 'OFFICE-B', location_name: 'Office B', type: 'office' })
      .expect(403);

    authenticate('tenant_manager');
    prisma.location.create.mockResolvedValue(locationRow('active'));
    await request(app.getHttpServer())
      .post('/api/locations')
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .send({ location_code: 'OFFICE-B', location_name: 'Office B', type: 'office' })
      .expect(201);

    prisma.location.findFirst.mockResolvedValue({ id: locationId, status: 'active' });
    prisma.location.update.mockResolvedValue(locationRow('inactive'));
    const response = await request(app.getHttpServer())
      .delete(`/api/locations/${locationId}`)
      .set('Authorization', `Bearer ${token('tenant_manager')}`)
      .expect(200);
    expect(response.body).toEqual(expect.objectContaining({ location_id: locationId, is_active: false }));

    expect(prisma.mailJob.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        status: 'queued',
        scanEvent: { is: { locationId } },
      },
      data: { status: 'failed', errorMessage: 'LOCATION_INACTIVE' },
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
      locationCode: 'OFFICE-B',
      name: 'Office B',
      type: 'office',
      status,
    };
  }
});
