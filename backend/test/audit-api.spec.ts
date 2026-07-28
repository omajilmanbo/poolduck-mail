import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma.service';

describe('Audit API role and tenant boundary', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const prisma = {
    user: { findFirst: jest.fn() },
    auditLog: { findMany: jest.fn(), create: jest.fn().mockResolvedValue(undefined) },
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'audit-api-secret';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication();
    jwt = module.get(JwtService);
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('forbids operator and constrains tenant_manager query to its token tenant', async () => {
    prisma.user.findFirst.mockImplementation(({ where }: { where: { id: string; tenantId: string } }) =>
      Promise.resolve({ id: where.id, tenantId: where.tenantId, email: 'user@example.local', role: where.id === 'tenant-manager-1' ? 'tenant_manager' : 'operator', status: 'active' }),
    );
    await request(app.getHttpServer()).get('/api/audit-logs').set('Authorization', `Bearer ${token('operator-1', 'operator')}`).expect(403);

    prisma.auditLog.findMany.mockResolvedValue([]);
    await request(app.getHttpServer()).get('/api/audit-logs').set('Authorization', `Bearer ${token('tenant-manager-1', 'tenant_manager')}`).expect(200).expect({ items: [], next_cursor: null });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-1' }),
    }));
  });

  function token(userId: string, role: string) {
    return jwt.sign({ sub: userId, user_id: userId, tenant_id: 'tenant-1', role });
  }
});
