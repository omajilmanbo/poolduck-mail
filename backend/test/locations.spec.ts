import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Locations API', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: {
    user: {
      findFirst: jest.Mock;
    };
    location: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
    };
    personMapping: {
      findMany: jest.Mock;
    };
  };

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const otherTenantId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';
  const locationId = '44444444-4444-4444-8444-444444444444';
  const email = 'manager@example.local';

  beforeAll(() => {
    process.env.JWT_SECRET = 'locations-spec-secret';
    process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '86400';
  });

  beforeEach(async () => {
    prisma = {
      user: {
        findFirst: jest.fn(),
      },
      location: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      personMapping: {
        findMany: jest.fn(),
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

  it('GET /api/locations should return locations for the current tenant only', async () => {
    prisma.user.findFirst.mockResolvedValue(currentUser());
    prisma.location.findMany.mockResolvedValue([
      {
        id: locationId,
        locationCode: 'office-a',
        name: 'Office A',
        type: 'office',
        status: 'active',
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        locationCode: 'school-b',
        name: 'School B',
        type: 'school',
        status: 'inactive',
      },
    ]);

    await request(app.getHttpServer())
      .get('/api/locations')
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(200)
      .expect([
        {
          location_id: locationId,
          location_code: 'office-a',
          location_name: 'Office A',
          type: 'office',
          is_active: true,
        },
        {
          location_id: '55555555-5555-4555-8555-555555555555',
          location_code: 'school-b',
          location_name: 'School B',
          type: 'school',
          is_active: false,
        },
      ]);

    expect(prisma.location.findMany).toHaveBeenCalledWith({
      where: { tenantId },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        locationCode: true,
        name: true,
        type: true,
        status: true,
      },
    });
  });

  it('GET /api/locations/:location_id/people should return masked people mappings for the current tenant and location', async () => {
    prisma.user.findFirst.mockResolvedValue(currentUser());
    prisma.location.findFirst.mockResolvedValue({ id: locationId });
    prisma.personMapping.findMany.mockResolvedValue([
      {
        id: '66666666-6666-4666-8666-666666666666',
        personName: 'Ada Lovelace',
        scanCode: 'SCAN-001',
        email: 'ada.lovelace@example.local',
        status: 'active',
      },
      {
        id: '77777777-7777-4777-8777-777777777777',
        personName: 'Q',
        scanCode: 'SCAN-002',
        email: 'q@example.local',
        status: 'inactive',
      },
    ]);

    const response = await request(app.getHttpServer())
      .get(`/api/locations/${locationId}/people`)
      .query({ tenant_id: otherTenantId })
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        person_id: '66666666-6666-4666-8666-666666666666',
        person_name: 'Ada Lovelace',
        scan_code: 'SCAN-001',
        email_masked: 'a***e@example.local',
        is_active: true,
      },
      {
        person_id: '77777777-7777-4777-8777-777777777777',
        person_name: 'Q',
        scan_code: 'SCAN-002',
        email_masked: '*@example.local',
        is_active: false,
      },
    ]);
    expect(JSON.stringify(response.body)).not.toContain(
      'ada.lovelace@example.local',
    );
    expect(prisma.location.findFirst).toHaveBeenCalledWith({
      where: {
        id: locationId,
        tenantId,
      },
      select: { id: true },
    });
    expect(prisma.personMapping.findMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        locationId,
      },
      orderBy: [{ personName: 'asc' }, { scanCode: 'asc' }],
      select: {
        id: true,
        personName: true,
        scanCode: true,
        email: true,
        status: true,
      },
    });
  });

  it('GET /api/locations/:location_id/people should reject cross-tenant locations', async () => {
    prisma.user.findFirst.mockResolvedValue(currentUser());
    prisma.location.findFirst.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .get(`/api/locations/${locationId}/people`)
      .set('Authorization', `Bearer ${accessToken()}`)
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'LOCATION_NOT_FOUND',
      message: 'location不存在或不属于当前租户',
    });
    expect(prisma.personMapping.findMany).not.toHaveBeenCalled();
  });

  it('GET /api/locations should reject unauthenticated requests', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/locations')
      .expect(401);

    expect(response.body).toMatchObject({
      code: 'UNAUTHORIZED',
      message: '未认证',
    });
    expect(prisma.location.findMany).not.toHaveBeenCalled();
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
