import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { normalizeWebhookPayloadForExtraction } from '../../utils/aiExtraction'
import { buildPaginatedResult, getPaginationParams } from '../../utils/pagination'
import { aiExtractionsService } from '../aiExtractions/aiExtractions.service'
import { groundedAnswersService } from '../groundedAnswers/groundedAnswers.service'
import type { PaginatedResult } from '../../types/pagination.types'
import type { ListWorkflowRunsQuery } from './workflowRuns.schema'
import { ProviderOperationError } from '../../services/provider/providerTransport'
import { claimWorkflow, finalizeWorkflow, heartbeatWorkflow, retryDelayMs, workflowLeasePolicy, type WorkflowClaim } from './workflowLease'

const workflowRunListSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  type: true,
  status: true,
  reviewStatus: true,
  deliveryStatus: true,
  confidence: true,
  startedAt: true,
  completedAt: true,
  errorMessage: true,
  attemptCount: true,
  maxAttempts: true,
  nextAttemptAt: true,
  leaseExpiresAt: true,
  organizationId: true,
  webhookEventId: true,
  webhookEvent: {
    select: {
      id: true,
      source: true,
      eventType: true,
      status: true,
      externalObjectType: true,
      externalObjectId: true,
      receivedAt: true,
      processedAt: true,
    },
  },
} satisfies Prisma.WorkflowRunSelect

const workflowRunDetailSelect = {
  ...workflowRunListSelect,
  input: true,
  output: true,
  webhookEvent: {
    select: {
      id: true,
      source: true,
      eventType: true,
      status: true,
      externalObjectType: true,
      externalObjectId: true,
      payload: true,
      receivedAt: true,
      processedAt: true,
      errorMessage: true,
      apiKeyId: true,
      integrationId: true,
    },
  },
} satisfies Prisma.WorkflowRunSelect

export type WorkflowRunListPayload = Prisma.WorkflowRunGetPayload<{
  select: typeof workflowRunListSelect
}>

export type WorkflowRunDetailPayload = Prisma.WorkflowRunGetPayload<{
  select: typeof workflowRunDetailSelect
}>

async function listWorkflowRuns(
  query: ListWorkflowRunsQuery,
  organizationId: string
): Promise<PaginatedResult<WorkflowRunListPayload>> {
  const { page, limit, skip } = getPaginationParams(query)

  const where: Prisma.WorkflowRunWhereInput = {
    organizationId,
    ...(query.status && { status: query.status }),
    ...(query.type && { type: query.type }),
  }

  const [items, total] = await prisma.$transaction([
    prisma.workflowRun.findMany({
      where,
      select: workflowRunListSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.workflowRun.count({ where }),
  ])

  return buildPaginatedResult({ items, total, page, limit })
}

async function getWorkflowRunById(
  workflowRunId: string,
  organizationId: string
): Promise<WorkflowRunDetailPayload> {
  const workflowRun = await prisma.workflowRun.findFirst({
    where: { id: workflowRunId, organizationId },
    select: workflowRunDetailSelect,
  })

  if (!workflowRun) {
    throw ApiError.notFound('Workflow run not found')
  }

  return workflowRun
}

async function processClaimedWorkflowRun(claim: WorkflowClaim, userId?: string, signal?: AbortSignal) {
  const workflowRun = await prisma.workflowRun.findFirst({
    where: {
      id: claim.id,
      organizationId: claim.organizationId,
    },
    include: {
      webhookEvent: {
        select: {
          id: true,
          eventType: true,
          payload: true,
        },
      },
    },
  })

  if (!workflowRun) throw ApiError.notFound('Workflow run not found')
  const abort = new AbortController()
  const onAbort = () => abort.abort(signal?.reason)
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  let heartbeatLost = false
  const heartbeat = setInterval(() => {
    heartbeatWorkflow(claim).then(owned => {
      if (!owned) { heartbeatLost = true; abort.abort(new Error('Workflow lease lost')) }
    }).catch(() => { heartbeatLost = true; abort.abort(new Error('Workflow heartbeat failed')) })
  }, Math.max(1000, Math.floor(workflowLeasePolicy.ttlMs / 3)))

  try {
    if (workflowRun.type === 'GROUNDED_TECHNICAL_ANSWER') {
      const input =
        workflowRun.input && typeof workflowRun.input === 'object' && !Array.isArray(workflowRun.input)
          ? (workflowRun.input as Record<string, unknown>)
          : {}
      const question =
        input.question ??
        input.content ??
        input.text ??
        input.message

      if (typeof question !== 'string' || question.trim().length < 3) {
        throw ApiError.badRequest('Grounded answer workflow requires a question')
      }

      const result = await groundedAnswersService.answerQuestion(
        {
          question,
          documentIds: Array.isArray(input.documentIds)
            ? input.documentIds.filter((id): id is string => typeof id === 'string')
            : undefined,
        },
        {
          organizationId: claim.organizationId,
          userId,
          workflowRunId: workflowRun.id,
          signal: abort.signal,
        }
      )

      await finalizeWorkflow(claim, {
          status: 'COMPLETED',
          reviewStatus: result.refused ? 'REQUIRED' : 'NOT_REQUESTED',
          confidence: result.confidence,
          output: result as unknown as Prisma.InputJsonValue,
          errorMessage: null,
      })
      return getWorkflowRunById(claim.id, claim.organizationId)
    }

    const extractionInput = workflowRun.webhookEvent
      ? normalizeWebhookPayloadForExtraction({
          eventType: workflowRun.webhookEvent.eventType,
          payload: workflowRun.webhookEvent.payload,
        })
      : normalizeWebhookPayloadForExtraction({
          eventType: workflowRun.type,
          payload: workflowRun.input,
        })

    const result = await aiExtractionsService.extractSalesEvent(extractionInput, {
      organizationId: claim.organizationId,
      userId,
      workflowRunId: workflowRun.id,
      signal: abort.signal,
    })

    const buyerQuestions = result.extraction.buyerQuestions ?? []
    const groundedAnswers = []
    
    if (buyerQuestions.length > 0) {
      for (const question of buyerQuestions) {
        try {
          const answerResult = await groundedAnswersService.answerQuestion(
            { question },
            {
              organizationId: claim.organizationId,
              userId,
              workflowRunId: workflowRun.id,
              signal: abort.signal,
            }
          )
          groundedAnswers.push({
            question,
            answer: answerResult.answer,
            refused: answerResult.refused,
            confidence: answerResult.confidence,
            citations: answerResult.citations,
          })
        } catch (error) {
          if (abort.signal.aborted) throw error
          console.error('Failed to get grounded answer for workflow question', error)
          groundedAnswers.push({ question, answer: null, refused: true, error: 'Answer processing failed', citations: [] })
        }
      }
    }

    const finalOutput = { ...result, groundedAnswers }

    await finalizeWorkflow(claim, {
        status: 'COMPLETED',
        reviewStatus: groundedAnswers.some(answer => answer.refused) ? 'REQUIRED' : 'NOT_REQUESTED',
        confidence: result.extraction.confidence,
        output: finalOutput as unknown as Prisma.InputJsonValue,
        errorMessage: null,
    })
    return getWorkflowRunById(claim.id, claim.organizationId)
  } catch (err) {
    const message = err instanceof Error && err.message.trim() ? err.message : 'Workflow processing failed'
    const retryable = !heartbeatLost && (signal?.aborted ||
      (err instanceof ProviderOperationError ? err.retryable : !(err instanceof ApiError) || err.statusCode >= 500))
    const willRetry = retryable && claim.attemptCount < claim.maxAttempts
    await finalizeWorkflow(claim, {
      status: willRetry ? 'RETRY_WAIT' : 'FAILED',
      errorMessage: message,
      nextAttemptAt: willRetry ? new Date(Date.now() + retryDelayMs(claim.attemptCount)) : undefined,
    })
    throw err
  } finally {
    clearInterval(heartbeat)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function processWorkflowRun(params: { workflowRunId: string; organizationId: string; userId?: string; signal?: AbortSignal }) {
  const run = await prisma.workflowRun.findFirst({ where: { id: params.workflowRunId, organizationId: params.organizationId } })
  if (!run) throw ApiError.notFound('Workflow run not found')
  if (run.status === 'COMPLETED') return getWorkflowRunById(run.id, params.organizationId)
  if (run.status !== 'QUEUED' && run.status !== 'RUNNING' && run.status !== 'RETRY_WAIT') {
    throw ApiError.conflict('Workflow run cannot be processed from its current state')
  }
  const claim = await claimWorkflow(params)
  return claim ? processClaimedWorkflowRun(claim, params.userId, params.signal) : getWorkflowRunById(run.id, params.organizationId)
}

async function processNextQueuedWorkflowRun(params: {
  organizationId?: string
  userId?: string
  signal?: AbortSignal
}) {
  if (params.signal?.aborted) return null
  const claim = await claimWorkflow({ organizationId: params.organizationId })
  if (claim && params.signal?.aborted) {
    await finalizeWorkflow(claim, {
      status: 'RETRY_WAIT',
      errorMessage: 'Worker stopped before processing began',
      nextAttemptAt: new Date(Date.now() + retryDelayMs(claim.attemptCount)),
    })
    return null
  }
  return claim ? processClaimedWorkflowRun(claim, params.userId, params.signal) : null
}

async function processQueuedWorkflowRuns(params: {
  organizationId?: string
  userId?: string
  limit?: number
  signal?: AbortSignal
}) {
  const limit = params.limit ?? 10
  const processed = []

  for (let index = 0; index < limit; index += 1) {
    if (params.signal?.aborted) break
    const workflowRun = await processNextQueuedWorkflowRun({
      organizationId: params.organizationId,
      userId: params.userId,
      signal: params.signal,
    })

    if (!workflowRun) break
    processed.push(workflowRun)
  }

  return processed
}

export const workflowRunsService = {
  listWorkflowRuns,
  getWorkflowRunById,
  processWorkflowRun,
  processNextQueuedWorkflowRun,
  processQueuedWorkflowRuns,
}
