ALTER TABLE "webhook_events" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "webhook_events_organizationId_idempotencyKey_key"
  ON "webhook_events"("organizationId", "idempotencyKey");
