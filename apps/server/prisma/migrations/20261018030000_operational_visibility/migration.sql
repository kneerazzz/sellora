CREATE TABLE "worker_heartbeats" (
  "role" TEXT PRIMARY KEY,
  "seenAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "usage_alert_events"
  ADD COLUMN "notifiedAt" TIMESTAMP(3),
  ADD COLUMN "notifyAfter" TIMESTAMP(3);
