import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Operator location assignment API', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: {
    $transaction: jest.Mock;
    user: { findFirst: jest.Mock };
    location: { findMany: jest.Mock; findFirst: jest.Mock };
    operatorLocationAssignment: {
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
    auditLog: { create: jest.Mock };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const managerId = '22222222-2222-4222-8222-222222222222';
  const operatorId = '33333333-3333-4333-8333-333333333333';
  const locationA = '44444444-4444-4444-8444-444444444444';
  const locationB = '55555555-5555-4555-8555-555555555555';

  beforeAll(() => {
    process.env.JWT_SECRET = 'operator-location-assignments-secret';
  });

  beforeEach(async () => {
    prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof prisma) => unknown) =>
        callback(prisma),
      ),
      user: { findFirst: jest.fn() },
      location: { findMany: jest.fn(), findFirst: jest.fn() },
      operatorLocationAssignment: {
        findMany: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    prisma.user.findFirst.mockImplementation(({ where }) => {
      if (where.id === managerId) {
        return Promise.resolve({
          id: managerId,
          tenantId,
          username: null,
          email: 'manager@example.local',
          role: 'tenant_manager',
          status: 'active',
        });
      }
      if (
        where.id === operatorId &&
        where.tenantId === tenantId &&
        where.role === 'operator'
      ) {
        return Promise.resolve({ id: operatorId });
      }
      return Promise.resolve(null);
    });

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

  afterEach(async () => app.close());

  it('queries current-tenant assignments without exposing PII', async () => {
    prisma.operatorLocationAssignment.findMany.mockResolvedValue([
      { location: locationRow(locationA, 'A001', 'Office A', 'active') },
      { location: locationRow(locationB, 'B001', 'Office B', 'inactive') },
    ]);

    const response = await request(app.getHttpServer())
      .get(`/api/users/${operatorId}/location-assignments`)
      .set('Authorization', managerAuthorization())
      .expect(200);

    expect(response.body).toEqual({
      operator_id: operatorId,
      locations: [
        {
          location_id: 'A001',
          location_code: 'A001',
          location_name: 'Office A',
          is_active: true,
        },
        {
          location_id: 'B001',
          location_code: 'B001',
          location_name: 'Office B',
          is_active: false,
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toContain('@');
    expect(prisma.operatorLocationAssignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId, operatorId },
      }),
    );
  });

  it('atomically replaces single or multiple assignments and audits counts', async () => {
    const locations = [
      locationRow(locationA, 'A001', 'Office A', 'active'),
      locationRow(locationB, 'B001', 'Office B', 'active'),
    ];
    prisma.location.findMany.mockResolvedValue(locations);
    prisma.operatorLocationAssignment.findMany.mockResolvedValue([
      { locationId: locationA },
    ]);

    const response = await request(app.getHttpServer())
      .put(`/api/users/${operatorId}/location-assignments`)
      .set('Authorization', managerAuthorization())
      .send({ location_ids: [locationA, locationB] })
      .expect(200);

    expect(response.body.locations).toHaveLength(2);
    expect(prisma.operatorLocationAssignment.deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        operatorId,
        locationId: { notIn: [locationA, locationB] },
      },
    });
    expect(prisma.operatorLocationAssignment.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId, operatorId, locationId: locationA },
        { tenantId, operatorId, locationId: locationB },
      ],
      skipDuplicates: true,
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'operator_location_assignment.set',
        actorUserId: managerId,
        resourceId: operatorId,
        metadataJson: {
          assignment_count: 2,
          added_count: 1,
          revoked_count: 0,
        },
      }),
    });
  });

  it('supports one assignment and fail-closed empty assignment sets', async () => {
    prisma.location.findMany.mockResolvedValue([
      locationRow(locationA, 'A001', 'Office A', 'active'),
    ]);
    prisma.operatorLocationAssignment.findMany.mockResolvedValueOnce([]);

    const single = await request(app.getHttpServer())
      .put(`/api/users/${operatorId}/location-assignments`)
      .set('Authorization', managerAuthorization())
      .send({ location_ids: [locationA] })
      .expect(200);
    expect(single.body.locations).toHaveLength(1);
    expect(prisma.operatorLocationAssignment.createMany).toHaveBeenCalledWith({
      data: [{ tenantId, operatorId, locationId: locationA }],
      skipDuplicates: true,
    });

    jest.clearAllMocks();
    prisma.operatorLocationAssignment.findMany.mockResolvedValue([
      { locationId: locationA },
    ]);
    const empty = await request(app.getHttpServer())
      .put(`/api/users/${operatorId}/location-assignments`)
      .set('Authorization', managerAuthorization())
      .send({ location_ids: [] })
      .expect(200);
    expect(empty.body).toEqual({ operator_id: operatorId, locations: [] });
    expect(prisma.operatorLocationAssignment.deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        operatorId,
        locationId: { notIn: [] },
      },
    });
    expect(prisma.operatorLocationAssignment.createMany).not.toHaveBeenCalled();
  });

  it('uses the same not-found response for inactive, missing, and cross-tenant locations', async () => {
    prisma.location.findMany.mockResolvedValue([
      locationRow(locationA, 'A001', 'Office A', 'active'),
    ]);

    const response = await request(app.getHttpServer())
      .put(`/api/users/${operatorId}/location-assignments`)
      .set('Authorization', managerAuthorization())
      .send({ location_ids: [locationA, locationB] })
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'ASSIGNABLE_LOCATION_NOT_FOUND',
    });
    expect(prisma.location.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          status: 'active',
        }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'authorization.operator_location_assignment.denied',
        result: 'denied',
      }),
    });
  });

  it('revokes an assignment immediately and records no PII', async () => {
    prisma.location.findFirst.mockResolvedValue({
      id: locationA,
      locationCode: 'A001',
      status: 'active',
    });

    const response = await request(app.getHttpServer())
      .delete(`/api/users/${operatorId}/location-assignments/${locationA}`)
      .set('Authorization', managerAuthorization())
      .expect(200);

    expect(response.body).toEqual({
      operator_id: operatorId,
      location_id: 'A001',
      status: 'revoked',
    });
    expect(prisma.operatorLocationAssignment.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, operatorId, locationId: locationA },
    });
    const auditPayload = prisma.auditLog.create.mock.calls.at(-1)?.[0];
    expect(auditPayload.data).toMatchObject({
      action: 'operator_location_assignment.revoked',
      actorUserId: managerId,
      metadataJson: { location_id: 'A001' },
    });
    expect(JSON.stringify(auditPayload)).not.toContain('@');
  });

  it('forbids operator self-service and rejects duplicate IDs', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({
      id: operatorId,
      tenantId,
      username: 'operator-1',
      email: 'operator@example.local',
      role: 'operator',
      status: 'active',
    });
    await request(app.getHttpServer())
      .put(`/api/users/${operatorId}/location-assignments`)
      .set('Authorization', `Bearer ${token(operatorId, 'operator')}`)
      .send({ location_ids: [locationA] })
      .expect(403);

    await request(app.getHttpServer())
      .put(`/api/users/${operatorId}/location-assignments`)
      .set('Authorization', managerAuthorization())
      .send({ location_ids: [locationA, locationA] })
      .expect(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a public code and UUID that resolve to the same location', async () => {
    prisma.location.findMany.mockResolvedValue([
      locationRow(locationA, 'A1B2C3D4', 'Office A', 'active'),
    ]);

    const response = await request(app.getHttpServer())
      .put(`/api/users/${operatorId}/location-assignments`)
      .set('Authorization', managerAuthorization())
      .send({ location_ids: [locationA, 'A1B2C3D4'] })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'DUPLICATE_LOCATION_ASSIGNMENT',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  function managerAuthorization() {
    return `Bearer ${token(managerId, 'tenant_manager')}`;
  }

  function token(userId: string, role: 'tenant_manager' | 'operator') {
    return jwtService.sign({
      sub: userId,
      user_id: userId,
      tenant_id: tenantId,
      role,
    });
  }

  function locationRow(
    id: string,
    locationCode: string,
    name: string,
    status: string,
  ) {
    return { id, locationCode, name, status };
  }
});
