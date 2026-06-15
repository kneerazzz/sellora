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
  type RfpExtractionInput,
} from './rfpExtraction.schema'
import { groundedAnswersService } from '../groundedAnswers/groundedAnswers.service'

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

  const result = await callLlmForSalesExtraction(validatedInput)

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
  input: RfpExtractionInput,
  context: {
    organizationId: string
    userId?: string
  }
) {
  const validatedInput = rfpExtractionBodySchema.parse(input)

  const result = await callLlmForRfpExtraction(validatedInput)

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
      userPrompt: input.content,
      response: JSON.stringify(result.output),
      retrievedChunkIds: [],
      queryVector: [],
      userId: context.userId,
      organizationId: context.organizationId,
    },
  })

  const answers = []
  for (const question of result.output.questions) {
    try {
      const answerResult = await groundedAnswersService.answerQuestion(
        { question, documentIds: validatedInput.documentIds },
        {
          organizationId: context.organizationId,
          userId: context.userId,
        }
      )
      answers.push({
        question,
        answer: answerResult.answer,
        refused: answerResult.refused,
        confidence: answerResult.confidence,
        citations: answerResult.citations,
      })
    } catch (err) {
      console.error(`Failed to answer RFP question: ${question}`, err)
    }
  }

  return {
    extractionAiInteractionId: aiInteraction.id,
    results: answers,
  }
}

export const aiExtractionsService = {
  extractSalesEvent,
  extractAndAnswerRfp,
}
