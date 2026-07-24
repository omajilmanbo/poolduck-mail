-- Roll back the application before running this script. Removing the assignment
-- table restores the previous permissive operator behavior in the old code.
DROP TABLE IF EXISTS "operator_location_assignments";

ALTER TABLE "locations"
DROP CONSTRAINT IF EXISTS "locations_tenant_id_id_key";

ALTER TABLE "users"
DROP CONSTRAINT IF EXISTS "users_tenant_id_id_key";
