ALTER TABLE "scan_events"
ADD COLUMN "action" VARCHAR(16) NOT NULL DEFAULT 'unknown',
ADD COLUMN "action_source" VARCHAR(32) NOT NULL DEFAULT 'legacy_unknown';

ALTER TABLE "scan_events"
ADD CONSTRAINT "scan_events_action_check"
CHECK ("action" IN ('entry', 'exit', 'unknown')),
ADD CONSTRAINT "scan_events_action_source_check"
CHECK ("action_source" IN ('person_action_code', 'manual_adjustment', 'legacy_unknown'));

CREATE INDEX "scan_events_tenant_id_location_id_person_mapping_id_received_at_idx"
ON "scan_events"("tenant_id", "location_id", "person_mapping_id", "received_at");

ALTER TABLE "mail_jobs"
ADD COLUMN "action_snapshot" VARCHAR(16) NOT NULL DEFAULT 'unknown';

ALTER TABLE "mail_jobs"
ADD CONSTRAINT "mail_jobs_action_snapshot_check"
CHECK ("action_snapshot" IN ('entry', 'exit', 'unknown'));

CREATE TABLE "scan_request_idempotency" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "route" VARCHAR(64) NOT NULL,
  "key_hash" VARCHAR(64) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "scan_event_id" UUID NOT NULL,
  "mail_job_id" UUID NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scan_request_idempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scan_request_idempotency_tenant_id_route_key_hash_key"
ON "scan_request_idempotency"("tenant_id", "route", "key_hash");

CREATE INDEX "scan_request_idempotency_expires_at_idx"
ON "scan_request_idempotency"("expires_at");

ALTER TABLE "scan_request_idempotency"
ADD CONSTRAINT "scan_request_idempotency_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "scan_request_idempotency_scan_event_id_fkey"
FOREIGN KEY ("scan_event_id") REFERENCES "scan_events"("id")
ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "scan_request_idempotency_mail_job_id_fkey"
FOREIGN KEY ("mail_job_id") REFERENCES "mail_jobs"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
