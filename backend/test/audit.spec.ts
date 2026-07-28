import { AuditService } from '../src/audit/audit.service';
import { PrismaService } from '../src/prisma.service';

describe('AuditService', () => {
  it('redacts sensitive keys, complete email addresses and bearer tokens', () => {
    const prisma = { auditLog: { create: jest.fn() } } as unknown as PrismaService;
    const service = new AuditService(prisma);

    expect(
      service.sanitize({
        password: 'do-not-store',
        nested: {
          recipient: 'private.person@example.com',
          detail: 'Authorization was Bearer abc.def.ghi',
          mail_body: 'private body',
        },
      }),
    ).toEqual({
      password: '[redacted]',
      nested: {
        recipient: '[redacted-email]',
        detail: 'Authorization was [redacted-token]',
        mail_body: '[redacted]',
      },
    });
  });

  it('does not throw when audit persistence fails', async () => {
    const prisma = {
      auditLog: { create: jest.fn().mockRejectedValue(new Error('db unavailable')) },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await expect(
      service.record({
        action: 'test.event',
        resourceType: 'test',
        resourceId: 'synthetic',
        result: 'failure',
      }),
    ).resolves.toBe(false);
  });

  it('lists and exports only the authenticated tenant with masked metadata', async () => {
    const findMany = jest.fn()
      .mockResolvedValueOnce([{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        actorUserId: null,
        action: 'mail.send',
        resourceType: 'mail_job',
        resourceId: 'job-1',
        result: 'success',
        metadataJson: { recipient: 'private@example.com' },
        createdAt: new Date('2026-07-22T00:00:00.000Z'),
      }])
      .mockResolvedValueOnce([{
        createdAt: new Date('2026-07-22T00:00:00.000Z'),
        action: 'mail.send',
        resourceType: 'mail_job',
        resourceId: 'job-1',
        result: 'success',
        metadataJson: { recipient: 'private@example.com' },
      }]);
    const prisma = { auditLog: { findMany, create: jest.fn().mockResolvedValue(undefined) } } as unknown as PrismaService;
    const service = new AuditService(prisma);
    const user = {
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      email: 'tenant-manager@example.local',
      username: null,
      role: 'tenant_manager',
    };

    const list = await service.listLogs(user, { limit: 25 });
    expect(list.items[0].metadata).toEqual({ recipient: '[redacted-email]' });
    expect(findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ tenantId: 'tenant-1' }));

    const csv = await service.exportLogs(user, {
      created_from: '2026-07-01T00:00:00.000Z', created_to: '2026-07-22T00:00:00.000Z',
    });
    expect(csv).toContain('[redacted-email]');
    expect(csv).not.toContain('private@example.com');
    expect(findMany.mock.calls[1][0].where).toEqual(expect.objectContaining({ tenantId: 'tenant-1' }));
  });

  it('rejects export ranges longer than 31 days', async () => {
    const prisma = { auditLog: { findMany: jest.fn(), create: jest.fn() } } as unknown as PrismaService;
    const service = new AuditService(prisma);
    await expect(service.exportLogs(
      {
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        email: 'tenant-manager@example.local',
        username: null,
        role: 'tenant_manager',
      },
      { created_from: '2026-01-01T00:00:00.000Z', created_to: '2026-03-01T00:00:00.000Z' },
    )).rejects.toMatchObject({ response: { code: 'INVALID_EXPORT_RANGE' } });
  });
});
