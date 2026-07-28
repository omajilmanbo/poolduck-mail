import { LocationAccessService } from '../src/location-access/location-access.service';

describe('LocationAccessService', () => {
  const operator = {
    user_id: 'operator-1',
    tenant_id: 'tenant-1',
    username: 'operator-1',
    email: 'operator@example.local',
    role: 'operator',
  };
  const manager = {
    ...operator,
    user_id: 'manager-1',
    role: 'tenant_manager',
  };

  it('adds assignment scope for operators and never for tenant_manager', () => {
    const service = new LocationAccessService({} as never, {} as never);
    expect(service.locationWhere(operator, { id: 'location-1' })).toEqual({
      id: 'location-1',
      tenantId: 'tenant-1',
      operatorLocationAssignments: {
        some: { tenantId: 'tenant-1', operatorId: 'operator-1' },
      },
    });
    expect(service.locationWhere(manager, { id: 'location-1' })).toEqual({
      id: 'location-1',
      tenantId: 'tenant-1',
    });
  });

  it('fails closed with the same not-found response and audits denied access', async () => {
    const prisma = {
      location: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const audit = { record: jest.fn().mockResolvedValue(true) };
    const service = new LocationAccessService(prisma as never, audit as never);

    await expect(
      service.assertLocation(operator, 'forged-location'),
    ).rejects.toMatchObject({
      response: {
        code: 'LOCATION_NOT_FOUND',
        message: 'location不存在或不属于当前租户',
      },
    });
    expect(prisma.location.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 'tenant-1',
          operatorLocationAssignments: {
            some: { tenantId: 'tenant-1', operatorId: 'operator-1' },
          },
        }),
        select: { id: true, locationCode: true, status: true },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'operator-1',
        action: 'authorization.location.denied',
        result: 'denied',
      }),
    );
  });
});
