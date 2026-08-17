-- Guarded rollback for ADR-018. Run only after stopping writes and confirming
-- that the environment has no business data. Deleted unmapped events are not restored.
CREATE TABLE "unmapped_scan_cases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "scan_event_id" UUID NOT NULL,
  "location_id" UUID,
  "status" VARCHAR(32) NOT NULL DEFAULT 'open',
  "handled_by_user_id" UUID,
  "handled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unmapped_scan_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unmapped_scan_cases_scan_event_id_key" ON "unmapped_scan_cases"("scan_event_id");
CREATE INDEX "unmapped_scan_cases_tenant_id_status_created_at_idx" ON "unmapped_scan_cases"("tenant_id", "status", "created_at");
CREATE INDEX "unmapped_scan_cases_tenant_id_location_id_created_at_idx" ON "unmapped_scan_cases"("tenant_id", "location_id", "created_at");

ALTER TABLE "unmapped_scan_cases" ADD CONSTRAINT "unmapped_scan_cases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unmapped_scan_cases" ADD CONSTRAINT "unmapped_scan_cases_scan_event_id_fkey" FOREIGN KEY ("scan_event_id") REFERENCES "scan_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unmapped_scan_cases" ADD CONSTRAINT "unmapped_scan_cases_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "unmapped_scan_cases" ADD CONSTRAINT "unmapped_scan_cases_handled_by_user_id_fkey" FOREIGN KEY ("handled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
