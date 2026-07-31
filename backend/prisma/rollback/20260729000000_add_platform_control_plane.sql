DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "platform_admins" LIMIT 1)
     OR EXISTS (SELECT 1 FROM "platform_audit_logs" LIMIT 1)
     OR EXISTS (SELECT 1 FROM "platform_tenant_idempotency" LIMIT 1)
     OR EXISTS (SELECT 1 FROM "users" WHERE "must_change_password" = TRUE LIMIT 1)
  THEN
    RAISE EXCEPTION
      'guarded rollback refused: platform identity, audit, provisioned tenant, or forced-password state exists';
  END IF;
END
$$;

DROP TABLE "platform_tenant_idempotency";
DROP TABLE "platform_audit_logs";
DROP TABLE "platform_sessions";
DROP TABLE "platform_admins";

ALTER TABLE "subscriptions"
  DROP CONSTRAINT "subscriptions_version_positive_check",
  DROP COLUMN "version";

ALTER TABLE "users"
  DROP COLUMN "must_change_password";

ALTER TABLE "tenants"
  DROP CONSTRAINT "tenants_location_limit_positive_check",
  DROP CONSTRAINT "tenants_platform_version_positive_check",
  DROP COLUMN "location_limit",
  DROP COLUMN "platform_version";
