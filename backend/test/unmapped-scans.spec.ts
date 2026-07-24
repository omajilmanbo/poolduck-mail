import { ConflictException, NotFoundException } from '@nestjs/common';
import { UnmappedScansService } from '../src/unmapped-scans/unmapped-scans.service';

describe('UnmappedScansService', () => {
  const operator = {
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    username: 'operator-1',
    email: 'operator@example.local',
    role: 'operator',
  };
  const locationAccess = {
    assertLocation: jest.fn(),
    resourceLocationWhere: jest.fn().mockReturnValue({
      location: {
        is: {
          tenantId: 'tenant-1',
          operatorLocationAssignments: {
            some: { tenantId: 'tenant-1', operatorId: 'user-1' },
          },
        },
      },
    }),
  };
  const row = {
    id: 'case-1',
    status: 'open',
    handledByUserId: null,
    handledAt: null,
    locationId: 'location-1',
    location: { name: 'Office', status: 'inactive' },
    scanEvent: {
      id: 'scan-1',
      scanCode: 'UNKNOWN',
      receivedAt: new Date('2026-07-23T00:00:00.000Z'),
    },
  };

  it('always scopes list queries to the authenticated tenant and preserves inactive history', async () => {
    const prisma = {
      unmappedScanCase: { findMany: jest.fn().mockResolvedValue([row]) },
    };
    const service = new UnmappedScansService(
      prisma as never,
      { record: jest.fn() } as never,
      locationAccess as never,
    );
    const result = await service.list(operator, { status: 'open' });

    expect(prisma.unmappedScanCase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: 'tenant-1',
        status: 'open',
        location: {
          is: {
            tenantId: 'tenant-1',
            operatorLocationAssignments: {
              some: { tenantId: 'tenant-1', operatorId: 'user-1' },
            },
          },
        },
      },
    }));
    expect(result[0]).toMatchObject({
      location_active: false,
      mapping_prefill_allowed: false,
      scan_code: 'UNKNOWN',
    });
  });

  it('rejects cross-tenant updates and records the denial', async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      unmappedScanCase: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const service = new UnmappedScansService(
      prisma as never,
      audit as never,
      locationAccess as never,
    );
    await expect(service.update(
      operator,
      'case-other',
      { status: 'resolved' },
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.unmappedScanCase.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'authorization.unmapped_scan.denied',
      result: 'denied',
    }));
  });

  it('does not mark a case resolved until an active tenant/location mapping exists', async () => {
    const prisma = {
      unmappedScanCase: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'case-1',
          locationId: 'location-1',
          scanEvent: { scanCode: 'UNKNOWN' },
        }),
        update: jest.fn(),
      },
      personMapping: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new UnmappedScansService(
      prisma as never,
      { record: jest.fn() } as never,
      locationAccess as never,
    );
    await expect(service.update(
      operator,
      'case-1',
      { status: 'resolved' },
    )).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.personMapping.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        locationId: 'location-1',
        OR: [{ personCode: 'UNKNOWN' }, { scanCode: 'UNKNOWN' }],
        status: 'active',
      },
      select: { id: true },
    });
    expect(prisma.unmappedScanCase.update).not.toHaveBeenCalled();
  });
});
