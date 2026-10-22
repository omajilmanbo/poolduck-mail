-- Expand-only tenant lifecycle state for ADR-023. Existing tenants keep NULL
-- deletion fields and their current status; no tenant or history row is changed.
ALTER TABLE "tenants"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "purge_after" TIMESTAMP(3),
  ADD COLUMN "deleted_from_status" VARCHAR(32),
  ADD COLUMN "deleted_from_subscription_status" VARCHAR(32);

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_deletion_lifecycle_check" CHECK (
    (
      "deleted_at" IS NULL
      AND "purge_after" IS NULL
      AND "deleted_from_status" IS NULL
      AND "deleted_from_subscription_status" IS NULL
      AND "status" NOT IN ('pending_delete', 'purged')
    )
    OR
    (
      "deleted_at" IS NOT NULL
      AND "purge_after" IS NOT NULL
      AND "purge_after" = "deleted_at" + INTERVAL '1 year'
      AND "deleted_from_status" IS NOT NULL
      AND "deleted_from_subscription_status" IS NOT NULL
      AND "deleted_from_subscription_status" IN ('trial', 'active', 'expired', 'suspended')
      AND "status" IN ('pending_delete', 'purged')
    )
  );

CREATE INDEX "tenants_purge_after_status_idx"
  ON "tenants"("purge_after", "status");
