import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { callLlmForSalesExtraction, callLlmForRfpExtraction, rfpExtractionSystemPrompt } from '../../utils/aiExtraction'
import {
  salesExtractionBodySchema,
  type SalesExtractionInput,
  type SalesExtractionOutput,
} from './aiExtractions.schema'
import {
  rfpExtractionBodySchema,
  rfpAnswerRowsBodySchema,
  type RfpRequestInput,
} from './rfpExtraction.schema'
import { answerRfpRows } from './rfpRows'
import { groundedAnswersService } from '../groundedAnswers/groundedAnswers.service'
import { withWorkloadReservation } from '../usage/workloadReservations.service'

async function extractSalesEvent(
  input: SalesExtractionInput,
  context: {
    organizationId: string
    userId?: string
    signal?: AbortSignal
    requestId?: string
    workflowRunId?: string
  }
): Promise<{ extraction: SalesExtractionOutput; aiInteractionId: string }> {
  const validatedInput = salesExtractionBodySchema.parse(input)

  if (validatedInput.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: validatedInput.leadId, organizationId: context.organizationId },
      select: { id: true },
    })
    if (!lead) throw ApiError.notFound('Lead not found')
  }

  if (validatedInput.dealId) {
    const deal = await prisma.deal.findFirst({
      where: { id: validatedInput.dealId, organizationId: context.organizationId },
      select: { id: true },
    })
    if (!deal) throw ApiError.notFound('Deal not found')
  }

  const result = await withWorkloadReservation({
    organizationId: context.organizationId,
    operation: 'sales_extraction',
    units: Math.max(1, validatedInput.content.length),
    requestId: context.requestId,
    workflowRunId: context.workflowRunId,
    work: async ({ markAttempted, usageTraceId }) => {
      markAttempted()
      return callLlmForSalesExtraction(validatedInput, { signal: context.signal, usage: { traceId: usageTraceId } })
    },
  })

  const aiInteraction = await prisma.aiInteraction.create({
    data: {
      type: validatedInput.sourceType === 'CALL_TRANSCRIPT' ? 'MEETING_SUMMARY' : 'CHAT_MESSAGE',
      model: result.model,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      latencyMs: result.latencyMs,
      isStreamed: false,
      systemPrompt: result.systemPrompt,
      userPrompt: result.userPrompt,
      response: result.rawResponse,
      retrievedChunkIds: [],
      queryVector: [],
      leadId: validatedInput.leadId,
      dealId: validatedInput.dealId,
      userId: context.userId,
      organizationId: context.organizationId,
    },
  })

  return {
    extraction: result.output,
    aiInteractionId: aiInteraction.id,
  }
}

async function extractAndAnswerRfp(
  input: RfpRequestInput,
  context: {
    organizationId: string
    userId?: string
    signal?: AbortSignal
    requestId?: string
    workflowRunId?: string
  }
) {
  const answerRows = rfpAnswerRowsBodySchema.safeParse(input)
  let extractionAiInteractionId: string | null = null
  let rows: { rowId: string; question: string }[]
  let documentIds: string[] | undefined

  if (answerRows.success) {
    rows = answerRows.data.rows
    documentIds = answerRows.data.documentIds
  } else {
    const validatedInput = rfpExtractionBodySchema.parse(input)
    documentIds = validatedInput.documentIds

    const result = await withWorkloadReservation({
      organizationId: context.organizationId,
      operation: 'rfp_extraction',
      units: Math.max(1, validatedInput.content.length),
      requestId: context.requestId,
      workflowRunId: context.workflowRunId,
      work: async ({ markAttempted, usageTraceId }) => {
        markAttempted()
        return callLlmForRfpExtraction(validatedInput, { signal: context.signal, usage: { traceId: usageTraceId } })
      },
    })

    const aiInteraction = await prisma.aiInteraction.create({
      data: {
        type: 'CHAT_MESSAGE',
        model: result.model,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        latencyMs: result.latencyMs,
        isStreamed: false,
        systemPrompt: rfpExtractionSystemPrompt,
        userPrompt: validatedInput.content,
        response: JSON.stringify(result.output),
        retrievedChunkIds: [],
        queryVector: [],
        userId: context.userId,
        organizationId: context.organizationId,
      },
    })
    extractionAiInteractionId = aiInteraction.id
    rows = result.output.questions.map((question, index) => ({ rowId: `extracted-${index + 1}`, question }))
  }

  const results = await answerRfpRows(rows, question =>
    groundedAnswersService.answerQuestion(
      { question, documentIds },
      {
        organizationId: context.organizationId,
        userId: context.userId,
        signal: context.signal,
        requestId: context.requestId,
        workflowRunId: context.workflowRunId,
      }
    ), context.signal)

  return {
    version: 1,
    extractionAiInteractionId,
    results,
  }
}

export const aiExtractionsService = {
  extractSalesEvent,
  extractAndAnswerRfp,
}
