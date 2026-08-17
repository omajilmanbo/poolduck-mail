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
const locationCodeMigrationPath = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260728000000_generate_location_codes',
  'migration.sql',
);
const locationCodeRollbackPath = join(
  __dirname,
  '..',
  'prisma',
  'rollback',
  '20260728000000_generate_location_codes.sql',
);
const tenantCodeMigrationPath = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260728010000_add_tenant_codes',
  'migration.sql',
);
const tenantCodeRollbackPath = join(
  __dirname,
  '..',
  'prisma',
  'rollback',
  '20260728010000_add_tenant_codes.sql',
);
const platformMigrationPath = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260729000000_add_platform_control_plane',
  'migration.sql',
);
const removeUnmappedMigrationPath = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260806000000_remove_unmapped_scan_cases',
  'migration.sql',
);
const removeUnmappedRollbackPath = join(
  __dirname,
  '..',
  'prisma',
  'rollback',
  '20260806000000_remove_unmapped_scan_cases.sql',
);
const scanCancellationMigrationPath = join(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20260806010000_add_scan_send_cancellation',
  'migration.sql',
);
const scanCancellationRollbackPath = join(
  __dirname,
  '..',
  'prisma',
  'rollback',
  '20260806010000_add_scan_send_cancellation.sql',
);
const platformRollbackPath = join(
  __dirname,
  '..',
  'prisma',
  'rollback',
  '20260729000000_add_platform_control_plane.sql',
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
  const locationCodeMigration = readFileSync(locationCodeMigrationPath, 'utf8');
  const locationCodeRollback = readFileSync(locationCodeRollbackPath, 'utf8');
  const tenantCodeMigration = readFileSync(tenantCodeMigrationPath, 'utf8');
  const tenantCodeRollback = readFileSync(tenantCodeRollbackPath, 'utf8');
  const platformMigration = readFileSync(platformMigrationPath, 'utf8');
  const platformRollback = readFileSync(platformRollbackPath, 'utf8');
  const removeUnmappedMigration = readFileSync(
    removeUnmappedMigrationPath,
    'utf8',
  );
  const removeUnmappedRollback = readFileSync(
    removeUnmappedRollbackPath,
    'utf8',
  );
  const scanCancellationMigration = readFileSync(
    scanCancellationMigrationPath,
    'utf8',
  );
  const scanCancellationRollback = readFileSync(
    scanCancellationRollbackPath,
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

  it('backfills public location IDs and fixed types without rewriting UUID relations', () => {
    expect(schema).toMatch(
      /locationCode\s+String\s+@map\("location_code"\) @db\.VarChar\(8\)/,
    );
    expect(schema).toMatch(
      /type\s+String\s+@default\("location"\) @db\.VarChar\(32\)/,
    );
    expect(schema).toContain('model LocationLegacyIdentifier');
    expect(locationCodeMigration).toContain(
      'INSERT INTO "location_legacy_identifiers"',
    );
    expect(locationCodeMigration).toContain(
      'ORDER BY "created_at", "id"',
    );
    expect(locationCodeMigration).toContain(
      "CHECK (\"location_code\" ~ '^[0-9A-HJKMNP-TV-Z]{8}$')",
    );
    expect(locationCodeMigration).toContain(
      'SET "location_code" = candidate',
    );
    expect(locationCodeMigration).not.toMatch(
      /UPDATE\s+"(?:person_mappings|scan_events|mail_jobs)"\s+SET\s+"location_id"/i,
    );
    expect(locationCodeRollback).toContain(
      'SET "location_code" = legacy."legacy_code"',
    );
    expect(locationCodeRollback).toContain(
      '"type" = legacy."legacy_type"',
    );
  });

  it('backfills unique tenant codes while preserving UUID primary and foreign keys', () => {
    expect(schema).toMatch(
      /tenantCode\s+String\s+@unique @map\("tenant_code"\) @db\.VarChar\(10\)/,
    );
    expect(tenantCodeMigration).toContain('ORDER BY "created_at", "id"');
    expect(tenantCodeMigration).toContain('FOR attempt IN 1..5 LOOP');
    expect(tenantCodeMigration).toContain(
      "CHECK (\"tenant_code\" ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$')",
    );
    expect(tenantCodeMigration).toContain(
      'CREATE UNIQUE INDEX "tenants_tenant_code_key"',
    );
    expect(tenantCodeMigration).not.toMatch(
      /UPDATE\s+"(?:users|subscriptions|locations|person_mappings|scan_events|mail_jobs)"\s+SET\s+"tenant_id"/i,
    );
    expect(tenantCodeRollback).toContain(
      'DROP COLUMN IF EXISTS "tenant_code"',
    );
    expect(tenantCodeRollback).not.toMatch(/DELETE\s+FROM\s+"tenants"/i);
  });

  it('removes the pre-launch unmapped case workflow with a guarded empty rollback', () => {
    expect(schema).not.toContain('model UnmappedScanCase');
    expect(schema).not.toContain('unmappedScanCases');
    expect(schema).not.toContain('unmappedScanCase');
    expect(removeUnmappedMigration).toContain(
      'DROP TABLE "unmapped_scan_cases";',
    );
    expect(removeUnmappedMigration).toContain(
      `DELETE FROM "scan_events"
WHERE "scan_type" = 'unmapped';`,
    );
    expect(removeUnmappedMigration.indexOf('DROP TABLE')).toBeLessThan(
      removeUnmappedMigration.indexOf('DELETE FROM "scan_events"'),
    );
    expect(removeUnmappedRollback).toContain(
      'CREATE TABLE "unmapped_scan_cases"',
    );
    expect(removeUnmappedRollback).not.toMatch(
      /INSERT\s+INTO\s+"unmapped_scan_cases"/i,
    );
  });

  it('adds a tenantless platform control plane, safe quota backfill and guarded rollback', () => {
    for (const model of [
      'PlatformAdmin',
      'PlatformSession',
      'PlatformAuditLog',
      'PlatformTenantIdempotency',
    ]) {
      expect(schema).toContain(`model ${model} `);
    }
    expect(platformMigration).toContain(
      'SET "location_limit" = GREATEST(',
    );
    expect(platformMigration).toMatch(
      /WHERE l\."tenant_id" = t\."id"\s+AND l\."status" <> 'purged'/,
    );
    expect(platformMigration).toContain(
      'CREATE UNIQUE INDEX "platform_admins_single_active_key"',
    );
    expect(platformMigration).toContain(
      `WHERE "status" = 'active'`,
    );
    expect(platformMigration).not.toMatch(
      /INSERT\s+INTO\s+"platform_admins"/i,
    );
    expect(platformRollback).toContain(
      'guarded rollback refused: platform identity, audit, provisioned tenant, or forced-password state exists',
    );
    expect(platformRollback).not.toMatch(
      /DELETE\s+FROM\s+"(?:tenants|users|subscriptions|locations|platform_audit_logs)"/i,
    );
  });

  it('adds database-time cancellation windows, delivery attempts and a guarded rollback', () => {
    expect(schema).toContain('model MailDeliveryAttempt');
    expect(schema).toContain('cancelUntil');
    expect(schema).toContain('sendNotBefore');
    expect(schema).toContain('claimAttemptId');
    expect(scanCancellationMigration).toContain(
      `ALTER COLUMN "status" SET DEFAULT 'waiting'`,
    );
    expect(scanCancellationMigration).toContain(
      `CURRENT_TIMESTAMP + INTERVAL '10 seconds'`,
    );
    expect(scanCancellationMigration).toContain(
      'CREATE TABLE "mail_delivery_attempts"',
    );
    expect(scanCancellationMigration).toContain(
      'mail_jobs_waiting_window_check',
    );
    expect(scanCancellationRollback).toContain(
      'rollback blocked: waiting mail jobs must be processed or canceled first',
    );
    expect(scanCancellationRollback).not.toMatch(
      /DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM/i,
    );
  });
});
