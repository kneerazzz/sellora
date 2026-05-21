-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('SALESFORCE', 'HUBSPOT', 'GMAIL', 'OUTLOOK', 'SLACK', 'RECALL_AI', 'N8N', 'CUSTOM');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'NEEDS_REAUTH', 'PAUSED');

-- CreateEnum
CREATE TYPE "ExternalObjectType" AS ENUM ('CONTACT', 'COMPANY', 'LEAD', 'DEAL', 'OPPORTUNITY', 'TASK', 'ACTIVITY', 'EMAIL', 'THREAD', 'MEETING', 'TRANSCRIPT', 'USER', 'OTHER');

-- CreateEnum
CREATE TYPE "WebhookEventSource" AS ENUM ('N8N', 'SALESFORCE', 'HUBSPOT', 'GMAIL', 'OUTLOOK', 'SLACK', 'RECALL_AI', 'MANUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('EMAIL_RECEIVED', 'EMAIL_SENT', 'CALL_TRANSCRIPT_RECEIVED', 'MEETING_LOGGED', 'CRM_RECORD_CREATED', 'CRM_RECORD_UPDATED', 'CRM_STAGE_CHANGED', 'MANUAL_QUESTION', 'DOCUMENT_UPLOADED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "WorkflowRunType" AS ENUM ('SALES_EVENT_EXTRACTION', 'GROUNDED_TECHNICAL_ANSWER', 'CRM_UPDATE_PREPARATION', 'EMAIL_DRAFT', 'CALL_SUMMARY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_object_mappings" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "externalObjectType" "ExternalObjectType" NOT NULL,
    "externalObjectId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "localLeadId" TEXT,
    "localDealId" TEXT,
    "metadata" JSONB,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT,

    CONSTRAINT "external_object_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "source" "WebhookEventSource" NOT NULL,
    "eventType" "WebhookEventType" NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "externalObjectType" "ExternalObjectType",
    "externalObjectId" TEXT,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "organizationId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "integrationId" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "type" "WorkflowRunType" NOT NULL,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'QUEUED',
    "confidence" "ConfidenceLevel",
    "input" JSONB NOT NULL,
    "output" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "organizationId" TEXT NOT NULL,
    "webhookEventId" TEXT,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "direction" "SyncDirection" NOT NULL,
    "status" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "IntegrationProvider" NOT NULL,
    "externalObjectType" "ExternalObjectType",
    "externalObjectId" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorMessage" TEXT,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT,
    "webhookEventId" TEXT,
    "workflowRunId" TEXT,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integrations_organizationId_idx" ON "integrations"("organizationId");

-- CreateIndex
CREATE INDEX "integrations_provider_idx" ON "integrations"("provider");

-- CreateIndex
CREATE INDEX "integrations_status_idx" ON "integrations"("status");

-- CreateIndex
CREATE INDEX "external_object_mappings_organizationId_idx" ON "external_object_mappings"("organizationId");

-- CreateIndex
CREATE INDEX "external_object_mappings_integrationId_idx" ON "external_object_mappings"("integrationId");

-- CreateIndex
CREATE INDEX "external_object_mappings_localLeadId_idx" ON "external_object_mappings"("localLeadId");

-- CreateIndex
CREATE INDEX "external_object_mappings_localDealId_idx" ON "external_object_mappings"("localDealId");

-- CreateIndex
CREATE UNIQUE INDEX "external_object_mappings_organizationId_provider_externalOb_key" ON "external_object_mappings"("organizationId", "provider", "externalObjectType", "externalObjectId");

-- CreateIndex
CREATE INDEX "webhook_events_organizationId_idx" ON "webhook_events"("organizationId");

-- CreateIndex
CREATE INDEX "webhook_events_apiKeyId_idx" ON "webhook_events"("apiKeyId");

-- CreateIndex
CREATE INDEX "webhook_events_integrationId_idx" ON "webhook_events"("integrationId");

-- CreateIndex
CREATE INDEX "webhook_events_source_idx" ON "webhook_events"("source");

-- CreateIndex
CREATE INDEX "webhook_events_eventType_idx" ON "webhook_events"("eventType");

-- CreateIndex
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");

-- CreateIndex
CREATE INDEX "webhook_events_externalObjectType_externalObjectId_idx" ON "webhook_events"("externalObjectType", "externalObjectId");

-- CreateIndex
CREATE INDEX "webhook_events_receivedAt_idx" ON "webhook_events"("receivedAt");

-- CreateIndex
CREATE INDEX "workflow_runs_organizationId_idx" ON "workflow_runs"("organizationId");

-- CreateIndex
CREATE INDEX "workflow_runs_webhookEventId_idx" ON "workflow_runs"("webhookEventId");

-- CreateIndex
CREATE INDEX "workflow_runs_type_idx" ON "workflow_runs"("type");

-- CreateIndex
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs"("status");

-- CreateIndex
CREATE INDEX "workflow_runs_createdAt_idx" ON "workflow_runs"("createdAt");

-- CreateIndex
CREATE INDEX "sync_logs_organizationId_idx" ON "sync_logs"("organizationId");

-- CreateIndex
CREATE INDEX "sync_logs_integrationId_idx" ON "sync_logs"("integrationId");

-- CreateIndex
CREATE INDEX "sync_logs_webhookEventId_idx" ON "sync_logs"("webhookEventId");

-- CreateIndex
CREATE INDEX "sync_logs_workflowRunId_idx" ON "sync_logs"("workflowRunId");

-- CreateIndex
CREATE INDEX "sync_logs_provider_idx" ON "sync_logs"("provider");

-- CreateIndex
CREATE INDEX "sync_logs_status_idx" ON "sync_logs"("status");

-- CreateIndex
CREATE INDEX "sync_logs_createdAt_idx" ON "sync_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_object_mappings" ADD CONSTRAINT "external_object_mappings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_object_mappings" ADD CONSTRAINT "external_object_mappings_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "webhook_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "workflow_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
