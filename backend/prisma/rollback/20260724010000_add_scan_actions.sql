-- Emergency rollback for Issue #95.
-- Take a database backup and stop application writes before running this file.

BEGIN;

DROP TABLE IF EXISTS "scan_request_idempotency";

ALTER TABLE "mail_jobs"
DROP CONSTRAINT IF EXISTS "mail_jobs_action_snapshot_check",
DROP COLUMN IF EXISTS "action_snapshot";

DROP INDEX IF EXISTS "scan_events_tenant_id_location_id_person_mapping_id_received_at_idx";

ALTER TABLE "scan_events"
DROP CONSTRAINT IF EXISTS "scan_events_action_source_check",
DROP CONSTRAINT IF EXISTS "scan_events_action_check",
DROP COLUMN IF EXISTS "action_source",
DROP COLUMN IF EXISTS "action";

COMMIT;
