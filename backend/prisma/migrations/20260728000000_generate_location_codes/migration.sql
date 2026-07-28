CREATE TABLE "location_legacy_identifiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "legacy_code" VARCHAR(128) NOT NULL,
    "legacy_type" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "location_legacy_identifiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "location_legacy_identifiers_tenant_id_legacy_code_key"
ON "location_legacy_identifiers"("tenant_id", "legacy_code");

CREATE INDEX "location_legacy_identifiers_tenant_id_location_id_idx"
ON "location_legacy_identifiers"("tenant_id", "location_id");

ALTER TABLE "location_legacy_identifiers"
ADD CONSTRAINT "location_legacy_identifiers_tenant_id_location_id_fkey"
FOREIGN KEY ("tenant_id", "location_id")
REFERENCES "locations"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "location_legacy_identifiers" (
    "tenant_id",
    "location_id",
    "legacy_code",
    "legacy_type"
)
SELECT "tenant_id", "id", upper(trim("location_code")), "type"
FROM "locations"
ORDER BY "created_at", "id";

CREATE OR REPLACE FUNCTION pg_temp.generate_location_code()
RETURNS VARCHAR(8)
LANGUAGE plpgsql
AS $$
DECLARE
    alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    entropy BYTEA := gen_random_bytes(8);
    generated TEXT := '';
    position INTEGER;
BEGIN
    FOR position IN 0..7 LOOP
        generated := generated || substr(
            alphabet,
            (get_byte(entropy, position) % 32) + 1,
            1
        );
    END LOOP;
    RETURN generated;
END;
$$;

DO $$
DECLARE
    target RECORD;
    candidate VARCHAR(8);
    attempt INTEGER;
    generated BOOLEAN;
BEGIN
    FOR target IN
        SELECT "id", "tenant_id"
        FROM "locations"
        ORDER BY "created_at", "id"
    LOOP
        generated := FALSE;
        FOR attempt IN 1..5 LOOP
            candidate := pg_temp.generate_location_code();
            generated := NOT EXISTS (
                SELECT 1
                FROM "locations"
                WHERE "tenant_id" = target."tenant_id"
                  AND "location_code" = candidate
                  AND "id" <> target."id"
            ) AND NOT EXISTS (
                SELECT 1
                FROM "location_legacy_identifiers"
                WHERE "tenant_id" = target."tenant_id"
                  AND "legacy_code" = candidate
            );
            EXIT WHEN generated;
        END LOOP;

        IF NOT generated THEN
            RAISE EXCEPTION 'location code generation exhausted for location %', target."id";
        END IF;

        UPDATE "locations"
        SET "location_code" = candidate,
            "type" = 'location'
        WHERE "id" = target."id";
    END LOOP;
END;
$$;

ALTER TABLE "locations"
ALTER COLUMN "location_code" TYPE VARCHAR(8),
ALTER COLUMN "type" SET DEFAULT 'location';

ALTER TABLE "locations"
ADD CONSTRAINT "locations_location_code_format_check"
CHECK ("location_code" ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
ADD CONSTRAINT "locations_type_location_check"
CHECK ("type" = 'location');
