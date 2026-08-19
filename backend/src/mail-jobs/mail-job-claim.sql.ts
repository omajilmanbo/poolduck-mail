export const CLAIM_DUE_MAIL_JOB_SQL = `UPDATE "mail_jobs"
 SET "status" = 'processing', "claimed_at" = CURRENT_TIMESTAMP,
     "claim_attempt_id" = $1::uuid, "updated_at" = CURRENT_TIMESTAMP
 WHERE "id" = $2::uuid AND "tenant_id" = $3::uuid
   AND (
     ($4::boolean AND "status" = 'waiting' AND date_trunc('milliseconds', CURRENT_TIMESTAMP) >= "send_not_before")
     OR ("status" = 'queued' AND "scheduled_at" IS NOT NULL AND date_trunc('milliseconds', CURRENT_TIMESTAMP) >= "scheduled_at")
     OR ("status" = 'queued' AND "scheduled_at" IS NULL AND "send_not_before" IS NULL)
   )`;
