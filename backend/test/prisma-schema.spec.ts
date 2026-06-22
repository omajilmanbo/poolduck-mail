import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schemaPath = join(__dirname, '..', 'prisma', 'schema.prisma');
const migrationPath = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260622000000_init',
  'migration.sql',
);

describe('Prisma initial schema', () => {
  const schema = readFileSync(schemaPath, 'utf8');
  const migration = readFileSync(migrationPath, 'utf8');

  it('defines the MVP initial models', () => {
    for (const model of [
      'Tenant',
      'User',
      'Subscription',
      'Device',
      'Location',
      'PersonMapping',
      'ScanEvent',
      'MailJob',
      'AuditLog',
    ]) {
      expect(schema).toContain(`model ${model} `);
    }
  });

  it('keeps tenant-scoped indexes and scan-code isolation constraints', () => {
    expect(schema).toContain('@@unique([tenantId, locationId, scanCode])');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "person_mappings_tenant_id_location_id_scan_code_key"',
    );
    expect(migration).toContain('CREATE INDEX "scan_events_tenant_id_received_at_idx"');
    expect(migration).toContain('CREATE INDEX "mail_jobs_tenant_id_status_created_at_idx"');
    expect(migration).toContain('CREATE INDEX "audit_logs_tenant_id_created_at_idx"');
  });
});
