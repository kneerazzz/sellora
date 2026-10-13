DROP INDEX "webhook_events_organizationId_idempotencyKey_key";
CREATE UNIQUE INDEX "webhook_events_organizationId_source_eventType_idempotencyKey_key"
  ON "webhook_events"("organizationId", "source", "eventType", "idempotencyKey");

CREATE TYPE "WorkflowRunActivityKind" AS ENUM
  ('RECEIVED', 'CLAIMED', 'CHECKPOINT', 'RETRY_WAIT', 'FAILED', 'COMPLETED', 'RETRIED', 'CANCELLED');

CREATE TABLE "workflow_run_activities" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "organizationId" TEXT NOT NULL,
  "workflowRunId" TEXT NOT NULL,
  "kind" "WorkflowRunActivityKind" NOT NULL,
  "attemptCount" INTEGER NOT NULL,
  "message" TEXT,
  "actorUserId" TEXT,
  CONSTRAINT "workflow_run_activities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workflow_run_activities_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workflow_run_activities_workflowRunId_fkey" FOREIGN KEY ("workflowRunId")
    REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "workflow_run_activities_organizationId_createdAt_idx"
  ON "workflow_run_activities"("organizationId", "createdAt");
CREATE INDEX "workflow_run_activities_workflowRunId_createdAt_idx"
  ON "workflow_run_activities"("workflowRunId", "createdAt");

INSERT INTO "workflow_run_activities"
  ("id", "createdAt", "organizationId", "workflowRunId", "kind", "attemptCount", "message")
SELECT 'legacy-' || "id", "updatedAt", "organizationId", "id",
  CASE "status"
    WHEN 'RUNNING' THEN 'CLAIMED'::"WorkflowRunActivityKind"
    WHEN 'RETRY_WAIT' THEN 'RETRY_WAIT'::"WorkflowRunActivityKind"
    WHEN 'FAILED' THEN 'FAILED'::"WorkflowRunActivityKind"
    WHEN 'COMPLETED' THEN 'COMPLETED'::"WorkflowRunActivityKind"
    WHEN 'CANCELLED' THEN 'CANCELLED'::"WorkflowRunActivityKind"
    ELSE 'RECEIVED'::"WorkflowRunActivityKind"
  END, "attemptCount", "errorMessage"
FROM "workflow_runs";
