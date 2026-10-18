ALTER TABLE "usage_alert_events"
  ADD COLUMN "clientNotifiedAt" TIMESTAMP(3),
  ADD COLUMN "clientNotifyAfter" TIMESTAMP(3);
