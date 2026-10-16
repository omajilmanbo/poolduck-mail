-- Index-only rollback. Do not remove attempt rows or submission identifiers.
DROP INDEX IF EXISTS "mail_delivery_attempts_provider_invoked_at_idx";
