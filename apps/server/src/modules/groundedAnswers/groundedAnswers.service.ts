import { prisma } from '../../config/prisma'
import {
  buildExtractiveAnswer,
  buildSnippet,
  scoreByTokenOverlap,
  tokenizeForRetrieval,
} from '../../utils/localRetrieval'
import type { GroundedAnswerInput } from './groundedAnswers.schema'
import { getEmbeddings } from '../../utils/embeddings'
import { hasEmbeddingsConfigured, searchSimilarChunks, VectorSearchResult } from '../../utils/vectorSearch'
import { rerank } from '../../utils/reranker'
import { callLlm } from '../../utils/llm'
import { env } from '../../config/env'

async function answerQuestion(
  input: GroundedAnswerInput,
  context: {
    organizationId: string
    userId?: string
  }
) {
  const maxCitations = input.maxCitations ?? 5

  if (hasEmbeddingsConfigured()) {
    try {
      const queryEmbeddings = await getEmbeddings([input.question])
      const queryVector = queryEmbeddings[0]

      if (!queryVector) {
        throw new Error('Failed to generate query embedding vector')
      }

      const matches = await searchSimilarChunks({
        organizationId: context.organizationId,
        queryVector,
        topK: maxCitations * 5,
        documentIds: input.documentIds,
        minScore: 0.15,
      })

      if (matches.length === 0) {
        return await handleRefusal(input.question, queryVector, context)
      }

      const rankedResults = rerank<VectorSearchResult>({
        items: matches.map((m) => ({ item: m, score: m.score })),
        question: input.question,
        getText: (m) => m.text,
        limit: maxCitations,
        vectorWeight: 0.7,
      })

      const topChunks = rankedResults.map((r) => r.item)

      if (topChunks.length === 0) {
        return await handleRefusal(input.question, queryVector, context)
      }

      const systemPrompt = [
        "You are Sellora, an expert AI assistant. Answer the user's question accurately using ONLY the provided company documentation.",
        'If the documentation does not contain enough evidence, you MUST refuse to answer and state exactly: "I do not have enough grounded document context to answer this question."',
        'Do not make up facts, guess, or extrapolate beyond the provided text.',
        'Respond naturally as a company expert. Do NOT use phrases like "Based on the provided document chunks" or "According to the provided chunks". Assume the context is your own internal knowledge.',
        'When referencing a specific detail, you may naturally mention the document name if helpful.',
      ].join('\n')

      const userPrompt = [
        `Question: ${input.question}`,
        '',
        'Context document chunks:',
        topChunks
          .map(
            (chunk, index) => {
              const pathStr = chunk.headingPath?.length > 0 ? chunk.headingPath.join(' > ') : 'General'
              return `[Source ${index + 1}] Document: ${chunk.displayName} | Section: ${pathStr}\nContent: ${chunk.text}`
            }
          )
          .join('\n\n'),
      ].join('\n')

      const llmResult = await callLlm({
        systemPrompt,
        userPrompt,
        temperature: 0,
      })

      const isRefused = llmResult.text.includes(
        'I do not have enough grounded document context to answer this question.'
      )

      if (isRefused) {
        return await handleRefusal(input.question, queryVector, context)
      }

      const citations = topChunks.map((chunk) => ({
        documentId: chunk.documentId,
        documentName: chunk.displayName,
        filename: chunk.filename,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        pageNumber: chunk.pageNumber,
        score: rankedResults.find((r) => r.item.chunkId === chunk.chunkId)?.combinedScore ?? chunk.score,
        snippet: buildSnippet(chunk.text),
      }))

      const topScore = rankedResults[0]?.combinedScore ?? 0
      const confidence =
        topScore >= 0.75 ? ('HIGH' as const) : topScore >= 0.6 ? ('MEDIUM' as const) : ('LOW' as const)

      const aiInteraction = await prisma.aiInteraction.create({
        data: {
          type: 'CHAT_MESSAGE',
          model: llmResult.model,
          promptTokens: llmResult.promptTokens,
          completionTokens: llmResult.completionTokens,
          totalTokens: llmResult.promptTokens + llmResult.completionTokens,
          latencyMs: llmResult.latencyMs,
          userPrompt: input.question,
          response: llmResult.text,
          retrievedChunkIds: citations.map((c) => c.chunkId),
          queryVector: queryVector,
          userId: context.userId,
          organizationId: context.organizationId,
        },
        select: { id: true },
      })

      return {
        answer: llmResult.text,
        refused: false,
        confidence,
        citations,
        aiInteractionId: aiInteraction.id,
      }
    } catch (error) {
      console.error('Error in pgvector-grounded QA, falling back to local...', error)
    }
  }

  // Fallback to local keyword overlap
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
    return await handleRefusal(input.question, [], context)
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
      queryVector: [],
      userId: context.userId,
      organizationId: context.organizationId,
    },
    select: { id: true },
  })

  return {
    answer,
    refused: false,
    confidence: scored[0]?.score && scored[0].score >= 0.5 ? ('MEDIUM' as const) : ('LOW' as const),
    citations,
    aiInteractionId: aiInteraction.id,
  }
}

async function handleRefusal(
  question: string,
  queryVector: number[],
  context: { organizationId: string; userId?: string }
) {
  const answer = 'I do not have enough grounded document context to answer this question.'
  const aiInteraction = await prisma.aiInteraction.create({
    data: {
      type: 'CHAT_MESSAGE',
      model: hasEmbeddingsConfigured()
        ? env.EMBEDDING_PROVIDER === 'openai'
          ? env.OPENAI_EMBEDDING_MODEL
          : 'all-minilm'
        : 'local-extractive-rag',
      promptTokens: 0,
      completionTokens: answer.length,
      totalTokens: answer.length,
      latencyMs: 0,
      userPrompt: question,
      response: answer,
      retrievedChunkIds: [],
      queryVector: queryVector,
      userId: context.userId,
      organizationId: context.organizationId,
    },
    select: { id: true },
  })

  return {
    answer,
    refused: true,
    confidence: 'LOW' as const,
    citations: [],
    aiInteractionId: aiInteraction.id,
  }
}

export const groundedAnswersService = {
  answerQuestion,
}
