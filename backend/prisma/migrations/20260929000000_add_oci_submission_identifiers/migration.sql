-- Add per-attempt correlation identifiers without changing existing mail jobs.
-- Null values preserve compatibility with historical and mock attempts.
ALTER TABLE "mail_delivery_attempts"
  ADD COLUMN "rfc_message_id" VARCHAR(512),
  ADD COLUMN "envelope_id" VARCHAR(512),
  ADD COLUMN "opc_request_id" VARCHAR(512);
