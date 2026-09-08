export type TenantProvisioningCsvRecord = {
  tenantName: string;
  tenantCode: string;
  managerEmail: string;
  temporaryPassword: string;
};

const FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

function csvCell(value: string, protectFormula = false) {
  const safeValue = protectFormula && FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}

export function createTenantProvisioningCsv(
  record: TenantProvisioningCsvRecord,
) {
  const header = [
    'tenant_name',
    'tenant_code',
    'tenant_manager_email',
    'temporary_password',
  ];
  const row = [
    csvCell(record.tenantName, true),
    csvCell(record.tenantCode),
    csvCell(record.managerEmail, true),
    csvCell(record.temporaryPassword),
  ];
  return `\uFEFF${header.join(',')}\r\n${row.join(',')}\r\n`;
}

export function tenantProvisioningCsvFilename(tenantCode: string) {
  return `poolduck-tenant-${tenantCode}-credentials.csv`;
}

export function downloadTenantProvisioningCsv(
  record: TenantProvisioningCsvRecord,
) {
  const blob = new Blob([createTenantProvisioningCsv(record)], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = tenantProvisioningCsvFilename(record.tenantCode);
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
