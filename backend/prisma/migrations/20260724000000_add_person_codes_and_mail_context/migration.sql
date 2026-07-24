ALTER TABLE "person_mappings"
ADD COLUMN "person_code" VARCHAR(12);

CREATE UNIQUE INDEX "person_mappings_person_code_key"
ON "person_mappings"("person_code");

CREATE OR REPLACE FUNCTION pg_temp.crockford32(value BIGINT, width INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  encoded TEXT := '';
  remaining BIGINT := value;
  position INTEGER;
BEGIN
  FOR position IN 1..width LOOP
    encoded := substr(alphabet, ((remaining & 31) + 1)::INTEGER, 1) || encoded;
    remaining := remaining >> 5;
  END LOOP;
  RETURN encoded;
END;
$$;

DO $$
DECLARE
  mapping RECORD;
  candidate TEXT;
  random_bytes BYTEA;
  random_value BIGINT;
  attempt INTEGER;
  assigned BOOLEAN;
BEGIN
  FOR mapping IN
    SELECT "id", "created_at"
    FROM "person_mappings"
    WHERE "person_code" IS NULL
    ORDER BY "created_at", "id"
  LOOP
    assigned := FALSE;
    FOR attempt IN 1..5 LOOP
      random_bytes := gen_random_bytes(4);
      random_value :=
        ((get_byte(random_bytes, 0)::BIGINT << 24)
        | (get_byte(random_bytes, 1)::BIGINT << 16)
        | (get_byte(random_bytes, 2)::BIGINT << 8)
        | get_byte(random_bytes, 3)::BIGINT) & 33554431;
      candidate :=
        pg_temp.crockford32(floor(extract(epoch FROM mapping."created_at"))::BIGINT, 7)
        || pg_temp.crockford32(random_value, 5);
      BEGIN
        UPDATE "person_mappings"
        SET "person_code" = candidate
        WHERE "id" = mapping."id";
        assigned := TRUE;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF attempt = 5 THEN
          RAISE EXCEPTION 'person_code backfill collision retries exhausted for mapping %', mapping."id";
        END IF;
      END;
    END LOOP;
    IF NOT assigned THEN
      RAISE EXCEPTION 'person_code backfill failed for mapping %', mapping."id";
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE "person_mappings"
ALTER COLUMN "person_code" SET NOT NULL;

ALTER TABLE "scan_events"
ADD COLUMN "person_mapping_id" UUID,
ADD COLUMN "person_code_snapshot" VARCHAR(12);

UPDATE "scan_events" AS scan
SET
  "person_mapping_id" = mapping."id",
  "person_code_snapshot" = mapping."person_code",
  "scan_code" = mapping."person_code"
FROM "person_mappings" AS mapping
WHERE mapping."tenant_id" = scan."tenant_id"
  AND mapping."location_id" = scan."location_id"
  AND mapping."scan_code" = scan."scan_code"
  AND scan."scan_type" <> 'unmapped';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "scan_events"
    WHERE "scan_type" <> 'unmapped'
      AND ("person_mapping_id" IS NULL OR "person_code_snapshot" IS NULL)
  ) THEN
    RAISE EXCEPTION 'mapped scan event backfill is incomplete';
  END IF;
END;
$$;

CREATE INDEX "scan_events_tenant_id_person_mapping_id_created_at_idx"
ON "scan_events"("tenant_id", "person_mapping_id", "created_at");

ALTER TABLE "scan_events"
ADD CONSTRAINT "scan_events_person_mapping_id_fkey"
FOREIGN KEY ("person_mapping_id") REFERENCES "person_mappings"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mail_jobs"
ADD COLUMN "location_id" UUID,
ADD COLUMN "person_mapping_id" UUID,
ADD COLUMN "tenant_name_snapshot" VARCHAR(255),
ADD COLUMN "location_name_snapshot" VARCHAR(255),
ADD COLUMN "person_name_snapshot" VARCHAR(255),
ADD COLUMN "person_code_snapshot" VARCHAR(12),
ADD COLUMN "context_snapshot_source" VARCHAR(32) NOT NULL DEFAULT 'legacy_backfill';

UPDATE "mail_jobs" AS job
SET
  "location_id" = scan."location_id",
  "person_mapping_id" = scan."person_mapping_id",
  "tenant_name_snapshot" = tenant."name",
  "location_name_snapshot" = location."name",
  "person_name_snapshot" = mapping."person_name",
  "person_code_snapshot" = mapping."person_code"
FROM "scan_events" AS scan
JOIN "tenants" AS tenant ON tenant."id" = scan."tenant_id"
JOIN "locations" AS location ON location."id" = scan."location_id"
JOIN "person_mappings" AS mapping ON mapping."id" = scan."person_mapping_id"
WHERE job."scan_event_id" = scan."id"
  AND job."tenant_id" = scan."tenant_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "mail_jobs"
    WHERE "scan_event_id" IS NULL
      OR "location_id" IS NULL
      OR "person_mapping_id" IS NULL
      OR "tenant_name_snapshot" IS NULL
      OR "location_name_snapshot" IS NULL
      OR "person_name_snapshot" IS NULL
      OR "person_code_snapshot" IS NULL
  ) THEN
    RAISE EXCEPTION 'mail context backfill is incomplete';
  END IF;
END;
$$;

ALTER TABLE "mail_jobs"
ALTER COLUMN "scan_event_id" SET NOT NULL,
ALTER COLUMN "location_id" SET NOT NULL,
ALTER COLUMN "person_mapping_id" SET NOT NULL,
ALTER COLUMN "tenant_name_snapshot" SET NOT NULL,
ALTER COLUMN "location_name_snapshot" SET NOT NULL,
ALTER COLUMN "person_name_snapshot" SET NOT NULL,
ALTER COLUMN "person_code_snapshot" SET NOT NULL;

ALTER TABLE "mail_jobs"
DROP CONSTRAINT "mail_jobs_scan_event_id_fkey";

ALTER TABLE "mail_jobs"
ADD CONSTRAINT "mail_jobs_scan_event_id_fkey"
FOREIGN KEY ("scan_event_id") REFERENCES "scan_events"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mail_jobs"
ADD CONSTRAINT "mail_jobs_location_id_fkey"
FOREIGN KEY ("location_id") REFERENCES "locations"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mail_jobs"
ADD CONSTRAINT "mail_jobs_person_mapping_id_fkey"
FOREIGN KEY ("person_mapping_id") REFERENCES "person_mappings"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "mail_jobs_tenant_id_location_id_created_at_idx"
ON "mail_jobs"("tenant_id", "location_id", "created_at");

CREATE INDEX "mail_jobs_tenant_id_person_mapping_id_created_at_idx"
ON "mail_jobs"("tenant_id", "person_mapping_id", "created_at");

ALTER TABLE "mail_jobs"
ALTER COLUMN "context_snapshot_source" SET DEFAULT 'scan_relation';
