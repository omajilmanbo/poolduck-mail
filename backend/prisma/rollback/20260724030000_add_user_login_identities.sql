DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "users"
    WHERE "email" IS NULL
  ) THEN
    RAISE EXCEPTION 'cannot roll back to email-only login while users without email exist';
  END IF;
END
$$;

ALTER TABLE "users"
  DROP CONSTRAINT IF EXISTS "users_identity_by_role_check",
  DROP CONSTRAINT IF EXISTS "users_email_format_check",
  DROP CONSTRAINT IF EXISTS "users_username_format_check";

DROP INDEX IF EXISTS "users_tenant_id_username_key";

ALTER TABLE "users"
  DROP COLUMN IF EXISTS "username",
  ALTER COLUMN "email" TYPE VARCHAR(255),
  ALTER COLUMN "email" SET NOT NULL;
