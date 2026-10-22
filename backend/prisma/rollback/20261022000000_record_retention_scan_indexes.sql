-- Stop all retention processors before this explicit, index-only rollback.
-- No rollback can restore records already destroyed by an enabled processor.
DO $$
BEGIN
  IF current_setting('app.allow_record_retention_index_rollback', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'RECORD_RETENTION_ROLLBACK_REQUIRES_EXPLICIT_GATE';
  END IF;
END $$;
DROP INDEX IF EXISTS "platform_audit_logs_due_at_id_idx";
DROP INDEX IF EXISTS "audit_logs_due_at_id_idx";
DROP INDEX IF EXISTS "scan_events_due_at_id_idx";
DROP INDEX IF EXISTS "scan_events_tenant_id_due_at_id_idx";
-- Keep provider_call_closed_at: dropping it would lose the safety evidence
-- needed when an unknown provider call is reconciled later.
