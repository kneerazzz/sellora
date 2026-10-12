CREATE TYPE "UsageTraceStatus" AS ENUM ('RUNNING', 'COMPLETED', 'REFUSED', 'FAILED', 'CANCELLED');
CREATE TYPE "UsageAttemptStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEADLINE_EXCEEDED');
CREATE TYPE "UsageCostCategory" AS ENUM ('PROVIDER', 'LOCAL_COMPUTE', 'STORAGE', 'INFRASTRUCTURE', 'AUTOMATION', 'HUMAN_SUPPORT');
CREATE TYPE "UsageUnitType" AS ENUM ('TOKENS', 'CHARACTERS', 'BYTES', 'ITEMS', 'MILLISECONDS');

CREATE TABLE "usage_traces" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "operation" TEXT NOT NULL,
  "status" "UsageTraceStatus" NOT NULL DEFAULT 'RUNNING',
  "requestId" TEXT,
  "workflowRunId" TEXT,
  "reservationId" TEXT,
  "errorCategory" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "elapsedMs" INTEGER,
  "rateVersion" TEXT NOT NULL DEFAULT 'unpriced-v1',
  "currency" TEXT,
  "estimatedCostMicros" BIGINT,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "usage_traces_elapsedMs_nonnegative" CHECK ("elapsedMs" IS NULL OR "elapsedMs" >= 0),
  CONSTRAINT "usage_traces_cost_nonnegative" CHECK ("estimatedCostMicros" IS NULL OR "estimatedCostMicros" >= 0)
);

CREATE TABLE "usage_attempts" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "component" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "category" "UsageCostCategory" NOT NULL,
  "provider" TEXT,
  "model" TEXT,
  "status" "UsageAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "errorCategory" TEXT,
  "httpStatus" INTEGER,
  "retryable" BOOLEAN,
  "cancellationMode" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "elapsedMs" INTEGER,
  "inputQuantity" INTEGER,
  "outputQuantity" INTEGER,
  "totalQuantity" INTEGER,
  "unitType" "UsageUnitType",
  "measurementStatus" "WorkloadMeasurementStatus" NOT NULL DEFAULT 'UNKNOWN',
  "rateVersion" TEXT NOT NULL DEFAULT 'unpriced-v1',
  "currency" TEXT,
  "inputRateMicros" BIGINT,
  "outputRateMicros" BIGINT,
  "estimatedCostMicros" BIGINT,
  "traceId" TEXT NOT NULL REFERENCES "usage_traces"("id") ON DELETE CASCADE,
  CONSTRAINT "usage_attempts_attemptNumber_positive" CHECK ("attemptNumber" > 0),
  CONSTRAINT "usage_attempts_elapsedMs_nonnegative" CHECK ("elapsedMs" IS NULL OR "elapsedMs" >= 0),
  CONSTRAINT "usage_attempts_quantities_nonnegative" CHECK (
    ("inputQuantity" IS NULL OR "inputQuantity" >= 0) AND
    ("outputQuantity" IS NULL OR "outputQuantity" >= 0) AND
    ("totalQuantity" IS NULL OR "totalQuantity" >= 0)
  ),
  CONSTRAINT "usage_attempts_unknown_quantity" CHECK (
    "measurementStatus" <> 'UNKNOWN' OR
    ("inputQuantity" IS NULL AND "outputQuantity" IS NULL AND "totalQuantity" IS NULL)
  ),
  CONSTRAINT "usage_attempts_cost_nonnegative" CHECK ("estimatedCostMicros" IS NULL OR "estimatedCostMicros" >= 0)
);

CREATE UNIQUE INDEX "usage_traces_reservationId_key" ON "usage_traces"("reservationId");
CREATE INDEX "usage_traces_organizationId_createdAt_idx" ON "usage_traces"("organizationId", "createdAt");
CREATE INDEX "usage_traces_organizationId_requestId_idx" ON "usage_traces"("organizationId", "requestId");
CREATE INDEX "usage_traces_workflowRunId_idx" ON "usage_traces"("workflowRunId");
CREATE INDEX "usage_traces_status_idx" ON "usage_traces"("status");
CREATE UNIQUE INDEX "usage_attempts_traceId_component_attemptNumber_key" ON "usage_attempts"("traceId", "component", "attemptNumber");
CREATE INDEX "usage_attempts_traceId_createdAt_idx" ON "usage_attempts"("traceId", "createdAt");
CREATE INDEX "usage_attempts_category_createdAt_idx" ON "usage_attempts"("category", "createdAt");
CREATE INDEX "usage_attempts_status_idx" ON "usage_attempts"("status");

ALTER TABLE "usage_traces" ADD CONSTRAINT "usage_traces_workflowRunId_fkey"
  FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE SET NULL;
ALTER TABLE "usage_traces" ADD CONSTRAINT "usage_traces_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "workload_reservations"("id") ON DELETE SET NULL;

-- Historical AI rows predate attempt-level accounting. Preserve them as explicitly
-- unknown instead of converting legacy token columns into measured usage.
INSERT INTO "usage_traces" (
  "id", "createdAt", "updatedAt", "operation", "status", "startedAt", "completedAt",
  "elapsedMs", "rateVersion", "organizationId"
)
SELECT
  'legacy_trace_' || "id", "createdAt", "createdAt", 'legacy_ai_interaction', 'COMPLETED',
  "createdAt", "createdAt", GREATEST("latencyMs", 0), 'legacy-unavailable-v1', "organizationId"
FROM "ai_interactions";

INSERT INTO "usage_attempts" (
  "id", "createdAt", "updatedAt", "component", "attemptNumber", "category", "provider", "model",
  "status", "startedAt", "completedAt", "elapsedMs", "measurementStatus", "rateVersion", "traceId"
)
SELECT
  'legacy_attempt_' || "id", "createdAt", "createdAt", 'legacy_ai_interaction', 1, 'PROVIDER', NULL, "model",
  'SUCCEEDED', "createdAt", "createdAt", GREATEST("latencyMs", 0), 'UNKNOWN', 'legacy-unavailable-v1',
  'legacy_trace_' || "id"
FROM "ai_interactions";
