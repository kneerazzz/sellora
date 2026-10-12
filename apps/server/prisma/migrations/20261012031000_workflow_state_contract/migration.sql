CREATE TYPE "WorkflowReviewStatus" AS ENUM ('NOT_REQUESTED', 'REQUIRED', 'APPROVED', 'REJECTED');
CREATE TYPE "WorkflowDeliveryStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SENT', 'FAILED');

ALTER TABLE "workflow_runs"
  ADD COLUMN "reviewStatus" "WorkflowReviewStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "deliveryStatus" "WorkflowDeliveryStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- Old NEEDS_REVIEW rows represented completed processing, not an active worker.
UPDATE "workflow_runs"
SET "reviewStatus" = 'REQUIRED', "status" = 'COMPLETED',
    "startedAt" = COALESCE("startedAt", "createdAt"),
    "completedAt" = COALESCE("completedAt", "updatedAt")
WHERE "status" = 'NEEDS_REVIEW';

UPDATE "workflow_runs"
SET "startedAt" = COALESCE("startedAt", "createdAt")
WHERE "status" IN ('RUNNING', 'COMPLETED', 'FAILED');

UPDATE "workflow_runs"
SET "completedAt" = COALESCE("completedAt", "updatedAt")
WHERE "status" IN ('COMPLETED', 'FAILED');

UPDATE "workflow_runs" SET "completedAt" = NULL
WHERE "status" IN ('QUEUED', 'RUNNING');

ALTER TABLE "workflow_runs"
  ADD CONSTRAINT "workflow_runs_terminal_time" CHECK (
    ("status" IN ('COMPLETED', 'FAILED', 'CANCELLED') AND "completedAt" IS NOT NULL)
    OR ("status" NOT IN ('COMPLETED', 'FAILED', 'CANCELLED') AND "completedAt" IS NULL)
  ),
  ADD CONSTRAINT "workflow_runs_started_time" CHECK (
    "status" = 'QUEUED' OR "startedAt" IS NOT NULL
  ),
  ADD CONSTRAINT "workflow_runs_review_time" CHECK (
    "reviewStatus" NOT IN ('APPROVED', 'REJECTED') OR "reviewedAt" IS NOT NULL
  ),
  ADD CONSTRAINT "workflow_runs_delivery_time" CHECK (
    "deliveryStatus" <> 'SENT' OR "deliveredAt" IS NOT NULL
  );
