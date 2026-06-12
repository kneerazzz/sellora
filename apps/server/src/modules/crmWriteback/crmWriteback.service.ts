import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import type { CrmWritebackPreviewInput } from './crmWriteback.schema'

type SalesExtractionWorkflowOutput = {
  extraction?: {
    summary?: string
    nextSteps?: string[]
    buyerQuestions?: string[]
    objections?: string[]
    riskFlags?: string[]
    confidence?: string
    confidenceReason?: string
    crmUpdate?: {
      stage?: string | null
      lastActivitySummary?: string | null
      nextFollowUpAt?: string | null
      priority?: string | null
    }
  }
  aiInteractionId?: string
}

function asObject(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function normalizeWorkflowOutput(output: Prisma.JsonValue | null): SalesExtractionWorkflowOutput {
  return asObject(output) as SalesExtractionWorkflowOutput
}

function buildSalesforcePayload(output: SalesExtractionWorkflowOutput) {
  const extraction = output.extraction
  const crmUpdate = extraction?.crmUpdate

  return {
    fields: {
      Description: extraction?.summary ?? null,
      NextStep: extraction?.nextSteps?.[0] ?? null,
      StageName: crmUpdate?.stage ?? null,
      Last_Activity_Summary__c: crmUpdate?.lastActivitySummary ?? extraction?.summary ?? null,
      Next_Follow_Up_At__c: crmUpdate?.nextFollowUpAt ?? null,
      Priority__c: crmUpdate?.priority ?? null,
      Buyer_Questions__c: extraction?.buyerQuestions?.join('\n') ?? '',
      Objections__c: extraction?.objections?.join('\n') ?? '',
      Risk_Flags__c: extraction?.riskFlags?.join('\n') ?? '',
      Sellora_Confidence__c: extraction?.confidence ?? null,
      Sellora_Confidence_Reason__c: extraction?.confidenceReason ?? null,
    },
  }
}

function buildHubSpotPayload(output: SalesExtractionWorkflowOutput) {
  const extraction = output.extraction
  const crmUpdate = extraction?.crmUpdate

  return {
    properties: {
      notes_last_contacted: crmUpdate?.lastActivitySummary ?? extraction?.summary ?? null,
      hs_next_step: extraction?.nextSteps?.[0] ?? null,
      dealstage: crmUpdate?.stage ?? null,
      sellora_next_follow_up_at: crmUpdate?.nextFollowUpAt ?? null,
      sellora_priority: crmUpdate?.priority ?? null,
      sellora_buyer_questions: extraction?.buyerQuestions?.join('\n') ?? '',
      sellora_objections: extraction?.objections?.join('\n') ?? '',
      sellora_risk_flags: extraction?.riskFlags?.join('\n') ?? '',
      sellora_confidence: extraction?.confidence ?? null,
      sellora_confidence_reason: extraction?.confidenceReason ?? null,
    },
  }
}

function buildGenericPayload(output: SalesExtractionWorkflowOutput) {
  return {
    summary: output.extraction?.summary ?? null,
    nextSteps: output.extraction?.nextSteps ?? [],
    buyerQuestions: output.extraction?.buyerQuestions ?? [],
    objections: output.extraction?.objections ?? [],
    riskFlags: output.extraction?.riskFlags ?? [],
    crmUpdate: output.extraction?.crmUpdate ?? null,
    confidence: output.extraction?.confidence ?? null,
    confidenceReason: output.extraction?.confidenceReason ?? null,
    aiInteractionId: output.aiInteractionId ?? null,
  }
}

function buildProviderPayload(provider: CrmWritebackPreviewInput['provider'], output: SalesExtractionWorkflowOutput) {
  switch (provider) {
    case 'SALESFORCE':
      return buildSalesforcePayload(output)
    case 'HUBSPOT':
      return buildHubSpotPayload(output)
    default:
      return buildGenericPayload(output)
  }
}

async function previewCrmWriteback(input: CrmWritebackPreviewInput, organizationId: string) {
  const workflowRun = await prisma.workflowRun.findFirst({
    where: {
      id: input.workflowRunId,
      organizationId,
    },
    include: {
      webhookEvent: {
        select: {
          id: true,
          externalObjectId: true,
          externalObjectType: true,
          integrationId: true,
        },
      },
    },
  })

  if (!workflowRun) {
    throw ApiError.notFound('Workflow run not found')
  }

  if (workflowRun.status !== 'COMPLETED' || !workflowRun.output) {
    throw ApiError.badRequest('Workflow run must be completed before preparing CRM writeback')
  }

  if (input.integrationId) {
    const integration = await prisma.integration.findFirst({
      where: {
        id: input.integrationId,
        organizationId,
        provider: input.provider,
      },
      select: { id: true },
    })

    if (!integration) {
      throw ApiError.notFound('Integration not found')
    }
  }

  const normalizedOutput = normalizeWorkflowOutput(workflowRun.output)
  const requestPayload = buildProviderPayload(input.provider, normalizedOutput)
  const externalObjectType =
    input.externalObjectType ?? workflowRun.webhookEvent?.externalObjectType ?? 'LEAD'
  const externalObjectId = input.externalObjectId ?? workflowRun.webhookEvent?.externalObjectId

  return prisma.syncLog.create({
    data: {
      direction: 'OUTBOUND',
      status: 'PENDING',
      provider: input.provider,
      externalObjectType,
      externalObjectId,
      requestPayload: requestPayload as Prisma.InputJsonValue,
      organizationId,
      integrationId: input.integrationId ?? workflowRun.webhookEvent?.integrationId,
      webhookEventId: workflowRun.webhookEventId,
      workflowRunId: workflowRun.id,
    },
    select: {
      id: true,
      status: true,
      direction: true,
      provider: true,
      externalObjectType: true,
      externalObjectId: true,
      requestPayload: true,
      workflowRunId: true,
      webhookEventId: true,
      integrationId: true,
      createdAt: true,
    },
  })
}

export const crmWritebackService = {
  previewCrmWriteback,
}
