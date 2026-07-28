-- Run only after rolling the application back to a version that accepts
-- tenant UUID login. Internal UUID primary and foreign keys are unchanged.
DROP INDEX IF EXISTS "tenants_tenant_code_key";

ALTER TABLE "tenants"
DROP CONSTRAINT IF EXISTS "tenants_tenant_code_format_check";

ALTER TABLE "tenants"
DROP COLUMN IF EXISTS "tenant_code";
