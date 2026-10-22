-- Serializes current-object writes with the tenant purge row lock. Historical rows are not altered.
CREATE FUNCTION reject_purged_tenant_current_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE tenant_status varchar(32);
BEGIN
  SELECT status INTO tenant_status FROM tenants WHERE id = NEW.tenant_id FOR SHARE;
  IF tenant_status = 'purged' THEN
    RAISE EXCEPTION 'TENANT_PURGED_CURRENT_WRITE'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_purged_tenant_write_guard BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION reject_purged_tenant_current_write();
CREATE TRIGGER devices_purged_tenant_write_guard BEFORE INSERT OR UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION reject_purged_tenant_current_write();
CREATE TRIGGER locations_purged_tenant_write_guard BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION reject_purged_tenant_current_write();
CREATE TRIGGER person_mappings_purged_tenant_write_guard BEFORE INSERT OR UPDATE ON person_mappings
  FOR EACH ROW EXECUTE FUNCTION reject_purged_tenant_current_write();
CREATE TRIGGER sessions_purged_tenant_write_guard BEFORE INSERT OR UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION reject_purged_tenant_current_write();
CREATE TRIGGER operator_location_assignments_purged_tenant_write_guard BEFORE INSERT OR UPDATE ON operator_location_assignments
  FOR EACH ROW EXECUTE FUNCTION reject_purged_tenant_current_write();
CREATE TRIGGER location_legacy_identifiers_purged_tenant_write_guard BEFORE INSERT OR UPDATE ON location_legacy_identifiers
  FOR EACH ROW EXECUTE FUNCTION reject_purged_tenant_current_write();
CREATE TRIGGER scan_request_idempotency_purged_tenant_write_guard BEFORE INSERT OR UPDATE ON scan_request_idempotency
  FOR EACH ROW EXECUTE FUNCTION reject_purged_tenant_current_write();
CREATE TRIGGER platform_tenant_idempotency_purged_tenant_write_guard BEFORE INSERT OR UPDATE ON platform_tenant_idempotency
  FOR EACH ROW EXECUTE FUNCTION reject_purged_tenant_current_write();
