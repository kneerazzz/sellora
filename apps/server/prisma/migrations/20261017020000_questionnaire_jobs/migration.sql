CREATE TABLE "questionnaire_jobs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "format" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "documentIds" TEXT[] NOT NULL,
  "leaseOwner" TEXT,
  "leaseVersion" INTEGER NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMP(3),
  CONSTRAINT "questionnaire_jobs_format_check" CHECK ("format" IN ('CSV', 'TEXT')),
  CONSTRAINT "questionnaire_jobs_status_check" CHECK ("status" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT "questionnaire_jobs_lease_check" CHECK (("status" = 'RUNNING' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL) OR ("status" <> 'RUNNING' AND "leaseOwner" IS NULL AND "leaseExpiresAt" IS NULL))
);
CREATE INDEX "questionnaire_jobs_organizationId_createdAt_idx" ON "questionnaire_jobs"("organizationId", "createdAt");
CREATE INDEX "questionnaire_jobs_status_leaseExpiresAt_idx" ON "questionnaire_jobs"("status", "leaseExpiresAt");

CREATE TABLE "questionnaire_rows" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "jobId" TEXT NOT NULL REFERENCES "questionnaire_jobs"("id") ON DELETE CASCADE,
  "rowIndex" INTEGER NOT NULL,
  "rowId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "answer" TEXT,
  "confidence" "ConfidenceLevel",
  "citations" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "errorCode" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "questionnaire_rows_status_check" CHECK ("status" IN ('QUEUED', 'PROCESSING', 'SUCCESS', 'REFUSAL', 'ERROR', 'CANCELLED')),
  CONSTRAINT "questionnaire_rows_attempt_check" CHECK ("attemptCount" BETWEEN 0 AND 2),
  CONSTRAINT "questionnaire_rows_index_check" CHECK ("rowIndex" >= 0),
  CONSTRAINT "questionnaire_rows_result_check" CHECK (("status" = 'SUCCESS' AND "answer" IS NOT NULL AND "confidence" IS NOT NULL) OR ("status" = 'REFUSAL' AND "answer" IS NOT NULL) OR ("status" IN ('QUEUED', 'PROCESSING', 'ERROR', 'CANCELLED')))
);
CREATE UNIQUE INDEX "questionnaire_rows_jobId_rowIndex_key" ON "questionnaire_rows"("jobId", "rowIndex");
CREATE INDEX "questionnaire_rows_jobId_status_idx" ON "questionnaire_rows"("jobId", "status");
