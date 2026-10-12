ALTER TABLE "workflow_runs"
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "heartbeatAt" TIMESTAMP(3);

-- Existing RUNNING rows have no trustworthy owner; make them reclaimable.
UPDATE "workflow_runs"
SET "leaseExpiresAt" = NOW() - INTERVAL '1 second', "attemptCount" = 1
WHERE "status" = 'RUNNING';

CREATE INDEX "workflow_runs_status_nextAttemptAt_idx" ON "workflow_runs"("status", "nextAttemptAt");
CREATE INDEX "workflow_runs_status_leaseExpiresAt_idx" ON "workflow_runs"("status", "leaseExpiresAt");

ALTER TABLE "workflow_runs"
  ADD CONSTRAINT "workflow_runs_attempt_bounds" CHECK
    ("attemptCount" >= 0 AND "maxAttempts" BETWEEN 1 AND 20 AND "leaseVersion" >= 0),
  ADD CONSTRAINT "workflow_runs_lease_shape" CHECK
    (("status" = 'RUNNING' AND "leaseExpiresAt" IS NOT NULL)
      OR ("status" <> 'RUNNING' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL)),
  ADD CONSTRAINT "workflow_runs_retry_time" CHECK
    (("status" = 'RETRY_WAIT' AND "nextAttemptAt" IS NOT NULL)
      OR ("status" <> 'RETRY_WAIT' AND "nextAttemptAt" IS NULL));
