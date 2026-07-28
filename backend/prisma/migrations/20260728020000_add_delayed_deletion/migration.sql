ALTER TABLE "locations"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "purge_after" TIMESTAMP(3),
  ADD COLUMN "deleted_from_status" VARCHAR(32);

ALTER TABLE "person_mappings"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "purge_after" TIMESTAMP(3),
  ADD COLUMN "deleted_from_status" VARCHAR(32);

CREATE INDEX "locations_purge_after_status_idx"
  ON "locations"("purge_after", "status");

CREATE INDEX "person_mappings_purge_after_status_idx"
  ON "person_mappings"("purge_after", "status");
