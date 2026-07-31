ALTER TABLE "tenants"
  ADD COLUMN "location_limit" INTEGER,
  ADD COLUMN "platform_version" INTEGER NOT NULL DEFAULT 1;

UPDATE "tenants" AS t
SET "location_limit" = GREATEST(
  1,
  (
    SELECT COUNT(*)::INTEGER
    FROM "locations" AS l
    WHERE l."tenant_id" = t."id"
      AND l."status" <> 'purged'
  )
);

ALTER TABLE "tenants"
  ALTER COLUMN "location_limit" SET NOT NULL,
  ADD CONSTRAINT "tenants_location_limit_positive_check"
    CHECK ("location_limit" > 0),
  ADD CONSTRAINT "tenants_platform_version_positive_check"
    CHECK ("platform_version" > 0);

ALTER TABLE "users"
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "subscriptions"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "subscriptions_version_positive_check"
    CHECK ("version" > 0);

CREATE TABLE "platform_admins" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" VARCHAR(254) NOT NULL,
  "password_hash" VARCHAR(255) NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'active',
  "identity_version" INTEGER NOT NULL DEFAULT 1,
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_admins_identity_version_positive_check"
    CHECK ("identity_version" > 0),
  CONSTRAINT "platform_admins_status_check"
    CHECK ("status" IN ('active', 'disabled'))
);

CREATE UNIQUE INDEX "platform_admins_email_key"
  ON "platform_admins"("email");
CREATE INDEX "platform_admins_status_idx"
  ON "platform_admins"("status");
CREATE UNIQUE INDEX "platform_admins_single_active_key"
  ON "platform_admins" ((1))
  WHERE "status" = 'active';

CREATE TABLE "platform_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "platform_admin_id" UUID NOT NULL,
  "identity_version_snapshot" INTEGER NOT NULL,
  "refresh_token_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_sessions_platform_admin_id_fkey"
    FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "platform_sessions_platform_admin_id_revoked_at_idx"
  ON "platform_sessions"("platform_admin_id", "revoked_at");
CREATE INDEX "platform_sessions_expires_at_idx"
  ON "platform_sessions"("expires_at");

CREATE TABLE "platform_audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "platform_admin_id" UUID,
  "target_tenant_id" UUID,
  "request_id" VARCHAR(128),
  "action" VARCHAR(128) NOT NULL,
  "resource_type" VARCHAR(128) NOT NULL,
  "resource_id" VARCHAR(128) NOT NULL,
  "result" VARCHAR(32) NOT NULL,
  "metadata_json" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_audit_logs_platform_admin_id_fkey"
    FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "platform_audit_logs_target_tenant_id_fkey"
    FOREIGN KEY ("target_tenant_id") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "platform_audit_logs_platform_admin_id_created_at_idx"
  ON "platform_audit_logs"("platform_admin_id", "created_at");
CREATE INDEX "platform_audit_logs_target_tenant_id_created_at_idx"
  ON "platform_audit_logs"("target_tenant_id", "created_at");

CREATE TABLE "platform_tenant_idempotency" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key_hash" VARCHAR(64) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "platform_admin_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_tenant_idempotency_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_tenant_idempotency_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "platform_tenant_idempotency_platform_admin_id_fkey"
    FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "platform_tenant_idempotency_key_hash_key"
  ON "platform_tenant_idempotency"("key_hash");
CREATE UNIQUE INDEX "platform_tenant_idempotency_tenant_id_key"
  ON "platform_tenant_idempotency"("tenant_id");
CREATE INDEX "platform_tenant_idempotency_expires_at_idx"
  ON "platform_tenant_idempotency"("expires_at");
