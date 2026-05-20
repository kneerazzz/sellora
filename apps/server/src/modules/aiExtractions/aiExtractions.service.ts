import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { callOpenAiForSalesExtraction } from '../../utils/aiExtraction'
import {
  salesExtractionBodySchema,
  type SalesExtractionInput,
  type SalesExtractionOutput,
} from './aiExtractions.schema'

async function extractSalesEvent(
  input: SalesExtractionInput,
  context: {
    organizationId: string
    userId?: string
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

  const result = await callOpenAiForSalesExtraction(validatedInput)

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
      pineconeQueryVector: [],
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

export const aiExtractionsService = {
  extractSalesEvent,
}
