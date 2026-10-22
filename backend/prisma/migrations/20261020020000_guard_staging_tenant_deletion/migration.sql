-- The durable Staging compensation state rejects current writes while physical cleanup retries.
CREATE OR REPLACE FUNCTION reject_purged_tenant_current_write() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE tenant_status varchar(32);
BEGIN
  SELECT status INTO tenant_status FROM tenants WHERE id = NEW.tenant_id FOR SHARE;
  IF tenant_status IN ('purged', 'staging_deleting') THEN
    RAISE EXCEPTION 'TENANT_CURRENT_WRITE_DISABLED'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
