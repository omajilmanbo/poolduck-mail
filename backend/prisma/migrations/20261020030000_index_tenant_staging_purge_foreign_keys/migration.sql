-- Tenant-scoped physical cleanup deletes many rows before their referenced parents.
-- PostgreSQL checks each foreign key separately, so these child-side indexes
-- prevent repeated full scans of deleted but not yet vacuumed rows.
CREATE INDEX "scan_events_device_id_idx" ON "scan_events"("device_id");
CREATE INDEX "scan_events_location_id_idx" ON "scan_events"("location_id");
CREATE INDEX "scan_events_person_mapping_id_idx" ON "scan_events"("person_mapping_id");
CREATE INDEX "scan_events_created_by_user_id_idx" ON "scan_events"("created_by_user_id");
CREATE INDEX "scan_events_canceled_by_user_id_idx" ON "scan_events"("canceled_by_user_id");
CREATE INDEX "mail_jobs_location_id_idx" ON "mail_jobs"("location_id");
CREATE INDEX "mail_jobs_person_mapping_id_idx" ON "mail_jobs"("person_mapping_id");
CREATE INDEX "mail_jobs_scan_event_id_idx" ON "mail_jobs"("scan_event_id");
CREATE INDEX "scan_request_idempotency_scan_event_id_idx" ON "scan_request_idempotency"("scan_event_id");
CREATE INDEX "scan_request_idempotency_mail_job_id_idx" ON "scan_request_idempotency"("mail_job_id");
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");
