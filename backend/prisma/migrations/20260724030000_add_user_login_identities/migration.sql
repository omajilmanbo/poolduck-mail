DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE "role" NOT IN ('tenant_manager', 'operator')
  ) THEN
    RAISE EXCEPTION 'user identity migration found an unsupported role';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users"
    GROUP BY "tenant_id", lower(btrim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'user identity migration found case-insensitive email conflicts';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE char_length(btrim("email")) NOT BETWEEN 3 AND 254
       OR lower(btrim("email")) !~ '^[!-~]+@[!-~]+$'
  ) THEN
    RAISE EXCEPTION 'user identity migration found an invalid email';
  END IF;
END
$$;

UPDATE "users"
SET "email" = lower(btrim("email"));

ALTER TABLE "users"
  ADD COLUMN "username" VARCHAR(32);

CREATE UNIQUE INDEX "users_tenant_id_username_key"
  ON "users"("tenant_id", "username");

DO $$
DECLARE
  user_record RECORD;
  candidate VARCHAR(32);
  attempt INTEGER;
BEGIN
  FOR user_record IN
    SELECT "id", "tenant_id"
    FROM "users"
    WHERE "role" = 'operator'
    ORDER BY "created_at", "id"
  LOOP
    attempt := 0;
    LOOP
      attempt := attempt + 1;
      candidate := 'op-' || substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 10);
      BEGIN
        UPDATE "users"
        SET "username" = candidate
        WHERE "id" = user_record."id";
        EXIT;
      EXCEPTION
        WHEN unique_violation THEN
          IF attempt >= 5 THEN
            RAISE EXCEPTION 'operator username generation exhausted for user %', user_record."id";
          END IF;
      END;
    END LOOP;
  END LOOP;
END
$$;

ALTER TABLE "users"
  ALTER COLUMN "email" TYPE VARCHAR(254),
  ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "users"
  ADD CONSTRAINT "users_username_format_check"
    CHECK (
      "username" IS NULL
      OR (
        "username" = lower(btrim("username"))
        AND char_length("username") BETWEEN 3 AND 32
        AND "username" ~ '^[a-z0-9]([a-z0-9._-]{1,30}[a-z0-9])?$'
        AND "username" NOT IN (
          'admin',
          'administrator',
          'root',
          'system',
          'support',
          'tenant_manager',
          'operator',
          'platform_admin',
          'poolduck'
        )
      )
    ),
  ADD CONSTRAINT "users_email_format_check"
    CHECK (
      "email" IS NULL
      OR (
        "email" = lower(btrim("email"))
        AND char_length("email") BETWEEN 3 AND 254
        AND "email" ~ '^[!-~]+@[!-~]+$'
      )
    ),
  ADD CONSTRAINT "users_identity_by_role_check"
    CHECK (
      ("role" = 'operator' AND "username" IS NOT NULL)
      OR
      ("role" = 'tenant_manager' AND "username" IS NULL AND "email" IS NOT NULL)
    );
