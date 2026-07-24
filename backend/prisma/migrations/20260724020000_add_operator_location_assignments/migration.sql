-- Existing operators intentionally receive no rows. This is the approved
-- fail-closed migration: tenant_manager must assign locations explicitly.
ALTER TABLE "users"
ADD CONSTRAINT "users_tenant_id_id_key" UNIQUE ("tenant_id", "id");

ALTER TABLE "locations"
ADD CONSTRAINT "locations_tenant_id_id_key" UNIQUE ("tenant_id", "id");

CREATE TABLE "operator_location_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_location_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "operator_location_assignments_tenant_id_operator_id_location_id_key"
ON "operator_location_assignments"("tenant_id", "operator_id", "location_id");

CREATE INDEX "operator_location_assignments_tenant_id_operator_id_idx"
ON "operator_location_assignments"("tenant_id", "operator_id");

CREATE INDEX "operator_location_assignments_tenant_id_location_id_idx"
ON "operator_location_assignments"("tenant_id", "location_id");

ALTER TABLE "operator_location_assignments"
ADD CONSTRAINT "operator_location_assignments_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operator_location_assignments"
ADD CONSTRAINT "operator_location_assignments_tenant_id_operator_id_fkey"
FOREIGN KEY ("tenant_id", "operator_id") REFERENCES "users"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "operator_location_assignments"
ADD CONSTRAINT "operator_location_assignments_tenant_id_location_id_fkey"
FOREIGN KEY ("tenant_id", "location_id") REFERENCES "locations"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
