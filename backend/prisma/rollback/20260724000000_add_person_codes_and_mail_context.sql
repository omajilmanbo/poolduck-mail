-- Emergency rollback for Issue #93.
-- Take a database backup and stop application writes before running this file.
-- New mappings remain readable by the legacy application because scan_code is
-- populated with person_code at creation time. Existing mapping scan_code values
-- were never overwritten by the forward migration.

BEGIN;

DROP INDEX IF EXISTS "mail_jobs_tenant_id_person_mapping_id_created_at_idx";
DROP INDEX IF EXISTS "mail_jobs_tenant_id_location_id_created_at_idx";

ALTER TABLE "mail_jobs"
DROP CONSTRAINT IF EXISTS "mail_jobs_person_mapping_id_fkey",
DROP CONSTRAINT IF EXISTS "mail_jobs_location_id_fkey",
DROP CONSTRAINT IF EXISTS "mail_jobs_scan_event_id_fkey";

ALTER TABLE "mail_jobs"
ALTER COLUMN "scan_event_id" DROP NOT NULL;

ALTER TABLE "mail_jobs"
ADD CONSTRAINT "mail_jobs_scan_event_id_fkey"
FOREIGN KEY ("scan_event_id") REFERENCES "scan_events"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mail_jobs"
DROP COLUMN "context_snapshot_source",
DROP COLUMN "person_code_snapshot",
DROP COLUMN "person_name_snapshot",
DROP COLUMN "location_name_snapshot",
DROP COLUMN "tenant_name_snapshot",
DROP COLUMN "person_mapping_id",
DROP COLUMN "location_id";

DROP INDEX IF EXISTS "scan_events_tenant_id_person_mapping_id_created_at_idx";

ALTER TABLE "scan_events"
DROP CONSTRAINT IF EXISTS "scan_events_person_mapping_id_fkey",
DROP COLUMN "person_code_snapshot",
DROP COLUMN "person_mapping_id";

DROP INDEX IF EXISTS "person_mappings_person_code_key";

ALTER TABLE "person_mappings"
DROP COLUMN "person_code";

COMMIT;
