ALTER TABLE "tenants"
ADD COLUMN "tenant_code" VARCHAR(10);

DO $$
DECLARE
  tenant_row RECORD;
  candidate TEXT;
  random_value BYTEA;
  alphabet CONSTANT TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  attempt INTEGER;
  position INTEGER;
  assigned BOOLEAN;
BEGIN
  FOR tenant_row IN
    SELECT "id"
    FROM "tenants"
    ORDER BY "created_at", "id"
  LOOP
    assigned := FALSE;

    FOR attempt IN 1..5 LOOP
      random_value := gen_random_bytes(10);
      candidate := '';

      FOR position IN 0..9 LOOP
        candidate := candidate
          || substr(alphabet, (get_byte(random_value, position) % 32) + 1, 1);
      END LOOP;

      IF NOT EXISTS (
        SELECT 1
        FROM "tenants"
        WHERE "tenant_code" = candidate
      ) THEN
        UPDATE "tenants"
        SET "tenant_code" = candidate
        WHERE "id" = tenant_row."id";
        assigned := TRUE;
        EXIT;
      END IF;
    END LOOP;

    IF NOT assigned THEN
      RAISE EXCEPTION
        'tenant_code generation exhausted for tenant %',
        tenant_row."id";
    END IF;
  END LOOP;
END
$$;

ALTER TABLE "tenants"
ALTER COLUMN "tenant_code" SET NOT NULL;

ALTER TABLE "tenants"
ADD CONSTRAINT "tenants_tenant_code_format_check"
CHECK ("tenant_code" ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$');

CREATE UNIQUE INDEX "tenants_tenant_code_key"
ON "tenants"("tenant_code");
