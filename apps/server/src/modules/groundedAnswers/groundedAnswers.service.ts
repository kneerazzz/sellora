import { prisma } from '../../config/prisma'
import {
  buildExtractiveAnswer,
  buildSnippet,
  scoreByTokenOverlap,
  tokenizeForRetrieval,
} from '../../utils/localRetrieval'
import type { GroundedAnswerInput } from './groundedAnswers.schema'

async function answerQuestion(input: GroundedAnswerInput, context: {
  organizationId: string
  userId?: string
}) {
  const maxCitations = input.maxCitations ?? 5
  const questionTokens = tokenizeForRetrieval(input.question)

  const chunks = await prisma.documentChunk.findMany({
    where: {
      document: {
        organizationId: context.organizationId,
        status: 'COMPLETED',
        ...(input.documentIds && { id: { in: input.documentIds } }),
      },
    },
    select: {
      id: true,
      text: true,
      chunkIndex: true,
      pageNumber: true,
      document: {
        select: {
          id: true,
          displayName: true,
          filename: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 250,
  })

  const scored = chunks
    .map((chunk) => ({
      chunk,
      score: questionTokens.length > 0 ? scoreByTokenOverlap(questionTokens, chunk.text) : 0,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCitations)

  if (scored.length === 0) {
    const response = {
      answer: 'I do not have enough grounded document context to answer this question.',
      refused: true,
      confidence: 'LOW' as const,
      citations: [],
    }

    const aiInteraction = await prisma.aiInteraction.create({
      data: {
        type: 'CHAT_MESSAGE',
        model: 'local-extractive-rag',
        promptTokens: questionTokens.length,
        completionTokens: response.answer.length,
        totalTokens: questionTokens.length + response.answer.length,
        latencyMs: 0,
        userPrompt: input.question,
        response: response.answer,
        retrievedChunkIds: [],
        pineconeQueryVector: [],
        userId: context.userId,
        organizationId: context.organizationId,
      },
      select: { id: true },
    })

    return {
      ...response,
      aiInteractionId: aiInteraction.id,
    }
  }

  const citations = scored.map(({ chunk, score }) => ({
    documentId: chunk.document.id,
    documentName: chunk.document.displayName,
    filename: chunk.document.filename,
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex,
    pageNumber: chunk.pageNumber,
    score,
    snippet: buildSnippet(chunk.text),
  }))

  const answer = buildExtractiveAnswer(
    input.question,
    citations.map((citation) => citation.snippet)
  )

  const aiInteraction = await prisma.aiInteraction.create({
    data: {
      type: 'CHAT_MESSAGE',
      model: 'local-extractive-rag',
      promptTokens: questionTokens.length,
      completionTokens: answer.length,
      totalTokens: questionTokens.length + answer.length,
      latencyMs: 0,
      userPrompt: input.question,
      response: answer,
      retrievedChunkIds: citations.map((citation) => citation.chunkId),
      pineconeQueryVector: [],
      userId: context.userId,
      organizationId: context.organizationId,
    },
    select: { id: true },
  })

  return {
    answer,
    refused: false,
    confidence: scored[0]?.score && scored[0].score >= 3 ? 'MEDIUM' as const : 'LOW' as const,
    citations,
    aiInteractionId: aiInteraction.id,
  }
}

export const groundedAnswersService = {
  answerQuestion,
}
