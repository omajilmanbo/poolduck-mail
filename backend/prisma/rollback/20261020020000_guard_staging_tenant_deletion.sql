-- Application rollback first; never reopen a Staging compensation state.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE status = 'staging_deleting') THEN
    RAISE EXCEPTION 'staging deletion guard rollback blocked: cleanup pending';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION reject_purged_tenant_current_write() RETURNS trigger
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
COMMIT;
