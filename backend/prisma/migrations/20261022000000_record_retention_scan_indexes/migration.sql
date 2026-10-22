-- Expand-only retention scan support. No historical row is rewritten or removed.
-- Prisma cannot express functional indexes; PostgreSQL owns these directly.
-- Only a returned provider call (or separately verified closure) makes an
-- unknown attempt eligible for retention destruction. Existing rows stay NULL.
ALTER TABLE "mail_delivery_attempts" ADD COLUMN "provider_call_closed_at" TIMESTAMP(3);
CREATE INDEX "scan_events_tenant_id_due_at_id_idx" ON "scan_events"("tenant_id", ("created_at" + INTERVAL '1 year'), "id");
CREATE INDEX "scan_events_due_at_id_idx" ON "scan_events"(("created_at" + INTERVAL '1 year'), "id");
CREATE INDEX "audit_logs_due_at_id_idx" ON "audit_logs"(("created_at" + INTERVAL '1 year'), "id");
CREATE INDEX "platform_audit_logs_due_at_id_idx" ON "platform_audit_logs"(("created_at" + INTERVAL '1 year'), "id");
