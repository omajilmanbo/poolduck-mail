ALTER TABLE "locations"
DROP CONSTRAINT IF EXISTS "locations_location_code_format_check",
DROP CONSTRAINT IF EXISTS "locations_type_location_check";

ALTER TABLE "locations"
ALTER COLUMN "location_code" TYPE VARCHAR(128),
ALTER COLUMN "type" DROP DEFAULT;

UPDATE "locations" AS location
SET "location_code" = legacy."legacy_code",
    "type" = legacy."legacy_type"
FROM "location_legacy_identifiers" AS legacy
WHERE legacy."tenant_id" = location."tenant_id"
  AND legacy."location_id" = location."id";

DROP TABLE IF EXISTS "location_legacy_identifiers";
