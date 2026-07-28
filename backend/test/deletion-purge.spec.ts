import { DeletionPurgeService } from '../src/locations/deletion-purge.service';

describe('DeletionPurgeService', () => {
  it('purges due locations, their people and assignments without deleting history', async () => {
    const tx = {
      personMapping: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      operatorLocationAssignment: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      locationLegacyIdentifier: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      location: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      location: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'location-internal',
            tenantId: 'tenant-1',
            locationCode: '10CA1001',
          },
        ]),
      },
      personMapping: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(true) };
    const service = new DeletionPurgeService(prisma as never, audit as never);
    const now = new Date('2026-08-11T00:00:00.000Z');

    await expect(service.processDueDeletions(now)).resolves.toEqual({
      locations: 1,
      people: 2,
    });
    expect(tx.personMapping.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          personName: '[deleted person]',
          email: 'deleted@invalid.local',
          status: 'purged',
        }),
      }),
    );
    expect(tx.operatorLocationAssignment.deleteMany).toHaveBeenCalled();
    expect(tx.locationLegacyIdentifier.deleteMany).toHaveBeenCalled();
    expect(tx.location.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'purged' }),
      }),
    );
    expect(prisma).not.toHaveProperty('scanEvent.deleteMany');
    expect(prisma).not.toHaveProperty('mailJob.deleteMany');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'location.purged',
        result: 'success',
      }),
    );
  });

  it('purges an independently due person idempotently', async () => {
    const prisma = {
      location: { findMany: jest.fn().mockResolvedValue([]) },
      personMapping: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'person-internal',
            tenantId: 'tenant-1',
            personCode: '01K0ABC10001',
            locationId: 'location-internal',
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(true) };
    const service = new DeletionPurgeService(prisma as never, audit as never);

    await expect(
      service.processDueDeletions(new Date('2026-08-11T00:00:00.000Z')),
    ).resolves.toEqual({ locations: 0, people: 1 });
    expect(prisma.personMapping.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'pending_delete',
          purgeAfter: { lte: expect.any(Date) },
        }),
        data: expect.objectContaining({
          personName: '[deleted person]',
          email: 'deleted@invalid.local',
          status: 'purged',
        }),
      }),
    );
  });
});
