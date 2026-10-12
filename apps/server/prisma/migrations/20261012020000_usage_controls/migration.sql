CREATE TABLE "organization_usage_controls" (
  "organizationId" TEXT PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedById" TEXT
);

CREATE TABLE "usage_alert_events" (
  "id" TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "usage_alert_events_organizationId_dedupeKey_key"
  ON "usage_alert_events"("organizationId", "dedupeKey");
CREATE INDEX "usage_alert_events_organizationId_createdAt_idx"
  ON "usage_alert_events"("organizationId", "createdAt");
