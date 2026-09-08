import { describe, expect, it } from 'vitest';
import {
  createTenantProvisioningCsv,
  tenantProvisioningCsvFilename,
} from '../src/platform/tenant-provisioning-csv';

describe('tenant provisioning CSV', () => {
  it('exports the initial tenant and one-time credential fields for Excel', () => {
    const csv = createTenantProvisioningCsv({
      tenantName: 'Example Tenant',
      tenantCode: '01ABCDEFGH',
      managerEmail: 'manager@example.local',
      temporaryPassword: 'Temporary123!',
    });

    expect(csv).toBe(
      '\uFEFFtenant_name,tenant_code,tenant_manager_email,temporary_password\r\n' +
        '"Example Tenant","01ABCDEFGH","manager@example.local","Temporary123!"\r\n',
    );
    expect(tenantProvisioningCsvFilename('01ABCDEFGH')).toBe(
      'poolduck-tenant-01ABCDEFGH-credentials.csv',
    );
  });

  it('escapes CSV punctuation and neutralizes spreadsheet formulas in input fields', () => {
    const csv = createTenantProvisioningCsv({
      tenantName: '=HYPERLINK("https://example.invalid","Tenant")',
      tenantCode: '01ABCDEFGH',
      managerEmail: '+manager@example.local',
      temporaryPassword: '-ExactPassword123!',
    });

    expect(csv).toContain(
      '"\'=HYPERLINK(""https://example.invalid"",""Tenant"")"',
    );
    expect(csv).toContain('"\'+manager@example.local"');
    expect(csv).toContain('"-ExactPassword123!"');
  });
});
