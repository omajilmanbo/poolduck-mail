import { AuditService } from '../src/audit/audit.service';
import { LicenseService } from '../src/license/license.service';
import { MailJobsService } from '../src/mail-jobs/mail-jobs.service';
import { SandboxMailProvider } from '../src/mail-jobs/sandbox-mail.provider';
import { PrismaService } from '../src/prisma.service';
import { ScanEventsService } from '../src/scan-events/scan-events.service';

const user = {
  user_id: 'user-1',
  tenant_id: 'tenant-1',
  username: null,
  email: 'tenant-manager@example.local',
  role: 'tenant_manager',
};
const range = { created_from: '2026-07-01T00:00:00.000Z', created_to: '2026-07-22T00:00:00.000Z' };

describe('history CSV exports', () => {
  it('exports tenant-scoped scan rows as UTF-8 CSV and escapes spreadsheet formulas', async () => {
    const findMany = jest.fn().mockResolvedValue([{
      id: 'scan-1', locationId: 'location-1', scanCode: '=SCAN', scanType: 'entry',
      personCodeSnapshot: null, action: 'entry', actionSource: 'person_action_code',
      receivedAt: new Date('2026-07-22T00:00:00.000Z'), createdAt: new Date('2026-07-22T00:00:00.000Z'),
      location: { name: '=Office' },
      mailJobs: [{ id: 'mail-1', status: 'sent', sentAt: new Date('2026-07-22T00:01:00.000Z'), errorMessage: null }],
    }]);
    const prisma = { scanEvent: { findMany } } as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(true) } as unknown as AuditService;
    const locationAccess = {
      resourceLocationWhere: jest.fn().mockReturnValue({}),
    };
    const service = new ScanEventsService(
      prisma,
      {} as LicenseService,
      audit,
      {} as never,
      locationAccess as never,
    );

    const csv = await service.exportScanEvents(user, range);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=Office");
    expect(csv).toContain("'=SCAN");
    expect(csv).toContain('"action","action_source"');
    expect(csv).toContain('"entry","person_action_code"');
    expect(findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ tenantId: 'tenant-1' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'scan.export' }));
  });

  it('partially masks recipient email and never exports mail body or provider secret', async () => {
    const findMany = jest.fn().mockResolvedValue([{
      id: 'mail-1', status: 'sent', createdAt: new Date('2026-07-22T00:00:00.000Z'),
      sentAt: new Date('2026-07-22T00:01:00.000Z'), errorMessage: null, toEmail: 'abcz@example.com',
      tenantNameSnapshot: 'Tenant', locationNameSnapshot: 'Office',
      personNameSnapshot: 'Person', personCodeSnapshot: '01K0ABC70001',
      actionSnapshot: 'exit', contextSnapshotSource: 'scan_relation',
      scanEvent: {
        id: 'scan-1', locationId: 'location-1', scanCode: '01K0ABC70001',
        action: 'exit', actionSource: 'person_action_code',
        receivedAt: new Date(), location: { name: 'Office' },
      },
    }]);
    const prisma = { mailJob: { findMany } } as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(true) } as unknown as AuditService;
    const locationAccess = {
      resourceLocationWhere: jest.fn().mockReturnValue({}),
    };
    const service = new MailJobsService(
      prisma,
      {} as LicenseService,
      {} as SandboxMailProvider,
      audit,
      locationAccess as never,
    );

    const csv = await service.exportMailJobs(user, range);
    expect(csv).toContain('a***z@example.com');
    expect(csv).not.toContain('abcz@example.com');
    expect(csv).not.toContain('body');
    expect(csv).toContain('"person_code","action","email_masked"');
    expect(csv).toContain('"01K0ABC70001","exit","a***z@example.com"');
    expect(findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ tenantId: 'tenant-1' }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'mail.export' }));
  });

  it('rejects history export ranges longer than 31 days', async () => {
    const service = new ScanEventsService(
      {} as PrismaService,
      {} as LicenseService,
      {} as AuditService,
      {} as never,
      {} as never,
    );
    await expect(service.exportScanEvents(user, {
      created_from: '2026-01-01T00:00:00.000Z', created_to: '2026-03-01T00:00:00.000Z',
    })).rejects.toMatchObject({ response: { code: 'INVALID_EXPORT_RANGE' } });
  });
});
