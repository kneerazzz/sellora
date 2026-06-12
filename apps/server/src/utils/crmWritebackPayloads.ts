import type { IntegrationProvider } from '@prisma/client'

export type SalesExtractionWorkflowOutput = {
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

export function asPlainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function normalizeSalesExtractionWorkflowOutput(
  output: unknown
): SalesExtractionWorkflowOutput {
  return asPlainObject(output) as SalesExtractionWorkflowOutput
}

export function buildSalesforcePayload(output: SalesExtractionWorkflowOutput) {
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

export function buildHubSpotPayload(output: SalesExtractionWorkflowOutput) {
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

export function buildGenericCrmPayload(output: SalesExtractionWorkflowOutput) {
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

export function buildCrmWritebackPayload(
  provider: IntegrationProvider,
  output: SalesExtractionWorkflowOutput
) {
  switch (provider) {
    case 'SALESFORCE':
      return buildSalesforcePayload(output)
    case 'HUBSPOT':
      return buildHubSpotPayload(output)
    default:
      return buildGenericCrmPayload(output)
  }
}
