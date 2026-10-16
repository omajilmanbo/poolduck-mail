-- Emergency schema rollback only before any OCI identifier has been recorded.
-- Stop writes and take a backup first. Once identifiers exist, roll back the
-- application while retaining these columns as immutable reconciliation evidence.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "mail_delivery_attempts"
    WHERE "rfc_message_id" IS NOT NULL
       OR "envelope_id" IS NOT NULL
       OR "opc_request_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'rollback blocked: OCI submission identifiers must be retained';
  END IF;
END $$;

ALTER TABLE "mail_delivery_attempts"
  DROP COLUMN "rfc_message_id",
  DROP COLUMN "envelope_id",
  DROP COLUMN "opc_request_id";

COMMIT;
