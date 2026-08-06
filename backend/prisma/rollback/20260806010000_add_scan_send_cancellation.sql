-- Guarded compatibility rollback for ADR-017. Evidence columns and attempt rows
-- are intentionally retained so canceled or uncertain deliveries cannot be
-- silently made sendable again.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "mail_jobs" WHERE "status" = 'waiting') THEN
    RAISE EXCEPTION 'rollback blocked: waiting mail jobs must be processed or canceled first';
  END IF;
END $$;

ALTER TABLE "mail_jobs"
  ALTER COLUMN "status" SET DEFAULT 'queued',
  ALTER COLUMN "cancel_until" DROP DEFAULT,
  ALTER COLUMN "send_not_before" DROP DEFAULT;

