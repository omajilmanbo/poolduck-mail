ALTER TABLE "scan_events"
  ADD COLUMN "canceled_at" TIMESTAMP(3),
  ADD COLUMN "canceled_by_user_id" UUID,
  ADD COLUMN "cancel_reason_code" VARCHAR(32),
  ADD CONSTRAINT "scan_events_canceled_by_user_id_fkey"
    FOREIGN KEY ("canceled_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "scan_events_cancellation_metadata_check"
    CHECK (
      ("canceled_at" IS NULL AND "canceled_by_user_id" IS NULL AND "cancel_reason_code" IS NULL)
      OR
      ("canceled_at" IS NOT NULL AND "cancel_reason_code" = 'OPERATOR_MISTAKE')
    );

ALTER TABLE "mail_jobs"
  ADD COLUMN "cancel_until" TIMESTAMP(3),
  ADD COLUMN "send_not_before" TIMESTAMP(3),
  ADD COLUMN "claimed_at" TIMESTAMP(3),
  ADD COLUMN "claim_attempt_id" UUID;

ALTER TABLE "mail_jobs"
  ALTER COLUMN "status" SET DEFAULT 'waiting',
  ALTER COLUMN "cancel_until" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '10 seconds'),
  ALTER COLUMN "send_not_before" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '10 seconds'),
  ADD CONSTRAINT "mail_jobs_waiting_window_check"
    CHECK (
      "status" <> 'waiting'
      OR (
        "cancel_until" IS NOT NULL
        AND "send_not_before" IS NOT NULL
        AND "scheduled_at" IS NULL
      )
    ),
  ADD CONSTRAINT "mail_jobs_retry_schedule_check"
    CHECK ("status" <> 'queued' OR "scheduled_at" IS NOT NULL OR "send_not_before" IS NULL),
  ADD CONSTRAINT "mail_jobs_claim_metadata_check"
    CHECK (
      "status" <> 'processing'
      OR ("claimed_at" IS NOT NULL AND "claim_attempt_id" IS NOT NULL)
    ) NOT VALID;

CREATE INDEX "mail_jobs_status_send_not_before_idx"
  ON "mail_jobs"("status", "send_not_before");
CREATE INDEX "mail_jobs_status_scheduled_at_idx"
  ON "mail_jobs"("status", "scheduled_at");
CREATE INDEX "mail_jobs_status_claimed_at_idx"
  ON "mail_jobs"("status", "claimed_at");

CREATE TABLE "mail_delivery_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "mail_job_id" UUID NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'claimed',
  "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "provider_invoked_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "provider_message_id" VARCHAR(255),
  "error_code" VARCHAR(64),
  CONSTRAINT "mail_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mail_delivery_attempts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "mail_delivery_attempts_mail_job_id_fkey"
    FOREIGN KEY ("mail_job_id") REFERENCES "mail_jobs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "mail_delivery_attempts_tenant_id_claimed_at_idx"
  ON "mail_delivery_attempts"("tenant_id", "claimed_at");
CREATE INDEX "mail_delivery_attempts_mail_job_id_claimed_at_idx"
  ON "mail_delivery_attempts"("mail_job_id", "claimed_at");
CREATE INDEX "mail_delivery_attempts_status_claimed_at_idx"
  ON "mail_delivery_attempts"("status", "claimed_at");
