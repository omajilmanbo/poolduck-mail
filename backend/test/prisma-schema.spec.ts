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
const personCodeMigrationPath = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260724000000_add_person_codes_and_mail_context',
  'migration.sql',
);
const personCodeRollbackPath = join(
  __dirname,
  '..',
  'prisma',
  'rollback',
  '20260724000000_add_person_codes_and_mail_context.sql',
);
const scanActionMigrationPath = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260724010000_add_scan_actions',
  'migration.sql',
);
const scanActionRollbackPath = join(
  __dirname,
  '..',
  'prisma',
  'rollback',
  '20260724010000_add_scan_actions.sql',
);
const operatorLocationMigrationPath = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260724020000_add_operator_location_assignments',
  'migration.sql',
);
const operatorLocationRollbackPath = join(
  __dirname,
  '..',
  'prisma',
  'rollback',
  '20260724020000_add_operator_location_assignments.sql',
);
const userIdentityMigrationPath = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260724030000_add_user_login_identities',
  'migration.sql',
);
const userIdentityRollbackPath = join(
  __dirname,
  '..',
  'prisma',
  'rollback',
  '20260724030000_add_user_login_identities.sql',
);

describe('Prisma initial schema', () => {
  const schema = readFileSync(schemaPath, 'utf8');
  const migration = readFileSync(migrationPath, 'utf8');
  const personCodeMigration = readFileSync(personCodeMigrationPath, 'utf8');
  const personCodeRollback = readFileSync(personCodeRollbackPath, 'utf8');
  const scanActionMigration = readFileSync(scanActionMigrationPath, 'utf8');
  const scanActionRollback = readFileSync(scanActionRollbackPath, 'utf8');
  const operatorLocationMigration = readFileSync(
    operatorLocationMigrationPath,
    'utf8',
  );
  const operatorLocationRollback = readFileSync(
    operatorLocationRollbackPath,
    'utf8',
  );
  const userIdentityMigration = readFileSync(
    userIdentityMigrationPath,
    'utf8',
  );
  const userIdentityRollback = readFileSync(
    userIdentityRollbackPath,
    'utf8',
  );

  it('defines the MVP initial models', () => {
    for (const model of [
      'Tenant',
      'User',
      'Subscription',
      'Device',
      'Location',
      'OperatorLocationAssignment',
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

  it('backfills immutable person codes and mail context before enforcing constraints', () => {
    expect(schema).toMatch(
      /personCode\s+String\s+@unique @map\("person_code"\) @db\.VarChar\(12\)/,
    );
    expect(schema).toMatch(
      /personMappingId\s+String\s+@map\("person_mapping_id"\)/,
    );
    expect(schema).toContain('tenantNameSnapshot');
    expect(schema).toContain('personCodeSnapshot');
    expect(personCodeMigration).toContain(
      'ORDER BY "created_at", "id"',
    );
    expect(personCodeMigration).toContain(
      "RAISE EXCEPTION 'mapped scan event backfill is incomplete'",
    );
    expect(personCodeMigration).toContain(
      "RAISE EXCEPTION 'mail context backfill is incomplete'",
    );
    expect(personCodeMigration).toContain(
      'ALTER COLUMN "person_code" SET NOT NULL',
    );
    expect(personCodeRollback).toContain(
      'ALTER COLUMN "scan_event_id" DROP NOT NULL',
    );
    expect(personCodeRollback).toContain(
      'DROP COLUMN "person_code"',
    );
    expect(personCodeRollback).not.toContain('DROP COLUMN "scan_code"');
  });

  it('persists scan action snapshots and 24-hour request idempotency references', () => {
    expect(schema).toMatch(
      /actionSource\s+String\s+@default\("legacy_unknown"\)/,
    );
    expect(schema).toMatch(
      /actionSnapshot\s+String\s+@default\("unknown"\)/,
    );
    expect(schema).toContain('model ScanRequestIdempotency');
    expect(scanActionMigration).toContain(
      'CHECK ("action" IN (\'entry\', \'exit\', \'unknown\'))',
    );
    expect(scanActionMigration).toContain(
      'CREATE TABLE "scan_request_idempotency"',
    );
    expect(scanActionMigration).toContain(
      'UNIQUE INDEX "scan_request_idempotency_tenant_id_route_key_hash_key"',
    );
    expect(scanActionRollback).toContain(
      'DROP TABLE IF EXISTS "scan_request_idempotency"',
    );
    expect(scanActionRollback).toContain(
      'DROP COLUMN IF EXISTS "action_source"',
    );
  });

  it('adds fail-closed tenant-scoped operator location assignments and rollback', () => {
    expect(schema).toContain('model OperatorLocationAssignment');
    expect(schema).toContain(
      '@@unique([tenantId, operatorId, locationId])',
    );
    expect(operatorLocationMigration).toContain(
      'CREATE TABLE "operator_location_assignments"',
    );
    expect(operatorLocationMigration).not.toMatch(
      /INSERT\s+INTO\s+"operator_location_assignments"/i,
    );
    expect(operatorLocationMigration).toContain(
      'REFERENCES "users"("tenant_id", "id")',
    );
    expect(operatorLocationMigration).toContain(
      'REFERENCES "locations"("tenant_id", "id")',
    );
    expect(operatorLocationRollback).toContain(
      'DROP TABLE IF EXISTS "operator_location_assignments"',
    );
  });

  it('backfills operator usernames and keeps a guarded email-only rollback', () => {
    expect(schema).toMatch(
      /username\s+String\?\s+@db\.VarChar\(32\)/,
    );
    expect(schema).toMatch(
      /email\s+String\?\s+@db\.VarChar\(254\)/,
    );
    expect(schema).toContain('@@unique([tenantId, username])');
    expect(userIdentityMigration).toContain(
      'case-insensitive email conflicts',
    );
    expect(userIdentityMigration).toContain(
      "candidate := 'op-' || substring(replace(gen_random_uuid()::text",
    );
    expect(userIdentityMigration).toContain(
      'ADD CONSTRAINT "users_identity_by_role_check"',
    );
    expect(userIdentityMigration).toContain(
      'ALTER COLUMN "email" DROP NOT NULL',
    );
    expect(userIdentityRollback).toContain(
      'cannot roll back to email-only login while users without email exist',
    );
    expect(userIdentityRollback).not.toMatch(/DELETE\s+FROM\s+"users"/i);
  });
});
