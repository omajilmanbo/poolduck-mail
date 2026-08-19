export const CANCEL_WAITING_MAIL_JOB_SQL = `UPDATE "mail_jobs"
 SET "status" = 'canceled', "updated_at" = CURRENT_TIMESTAMP
 WHERE "id" = $1::uuid
   AND "tenant_id" = $2::uuid
   AND "location_id" = $3::uuid
   AND "scan_event_id" = $4::uuid
   AND "status" = 'waiting'
   AND date_trunc('milliseconds', CURRENT_TIMESTAMP) < "cancel_until"`;

export const MARK_SCAN_EVENT_CANCELED_SQL = `UPDATE "scan_events"
 SET "canceled_at" = CURRENT_TIMESTAMP,
     "canceled_by_user_id" = $1::uuid,
     "cancel_reason_code" = 'OPERATOR_MISTAKE'
 WHERE "id" = $2::uuid
   AND "tenant_id" = $3::uuid
   AND "location_id" = $4::uuid
   AND "canceled_at" IS NULL`;
