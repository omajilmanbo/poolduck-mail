-- Application rollback first; guard stays in place while terminal tombstones exist.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE status IN ('pending_delete', 'purged', 'staging_deleting')) THEN
    RAISE EXCEPTION 'tenant current-write guard rollback blocked: deletion state exists';
  END IF;
END $$;

DROP TRIGGER platform_tenant_idempotency_purged_tenant_write_guard ON platform_tenant_idempotency;
DROP TRIGGER scan_request_idempotency_purged_tenant_write_guard ON scan_request_idempotency;
DROP TRIGGER location_legacy_identifiers_purged_tenant_write_guard ON location_legacy_identifiers;
DROP TRIGGER operator_location_assignments_purged_tenant_write_guard ON operator_location_assignments;
DROP TRIGGER sessions_purged_tenant_write_guard ON sessions;
DROP TRIGGER person_mappings_purged_tenant_write_guard ON person_mappings;
DROP TRIGGER locations_purged_tenant_write_guard ON locations;
DROP TRIGGER devices_purged_tenant_write_guard ON devices;
DROP TRIGGER users_purged_tenant_write_guard ON users;
DROP FUNCTION reject_purged_tenant_current_write();
COMMIT;
