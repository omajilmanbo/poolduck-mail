-- Run only after reverting application code and stopping tenant lifecycle writes.
-- Once deletion has started, keep the schema so old code cannot reopen the tenant.
BEGIN;

LOCK TABLE "tenants" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "tenants"
    WHERE "deleted_at" IS NOT NULL
       OR "purge_after" IS NOT NULL
       OR "deleted_from_status" IS NOT NULL
       OR "deleted_from_subscription_status" IS NOT NULL
       OR "status" IN ('pending_delete', 'purged')
  ) THEN
    RAISE EXCEPTION 'tenant lifecycle rollback blocked: deletion state exists';
  END IF;
END $$;

DROP INDEX "tenants_purge_after_status_idx";

ALTER TABLE "tenants"
  DROP CONSTRAINT "tenants_deletion_lifecycle_check",
  DROP COLUMN "deleted_at",
  DROP COLUMN "purge_after",
  DROP COLUMN "deleted_from_status",
  DROP COLUMN "deleted_from_subscription_status";

COMMIT;
