-- Support the global OCI pacing lookup without scanning all historical attempts.
CREATE INDEX "mail_delivery_attempts_provider_invoked_at_idx"
  ON "mail_delivery_attempts"("provider_invoked_at");
