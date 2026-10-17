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
import { createGmailReviewTask, type GmailReviewAnswer } from '../drafts/gmailReviewTask'
import { gmailReceivedSchema } from '../webhooks/webhooks.schema'
import { claimWorkflow, checkpointWorkflow, finalizeWorkflow, heartbeatWorkflow, retryDelayMs, workflowLeasePolicy, type WorkflowClaim } from './workflowLease'

type SalesResult = Awaited<ReturnType<typeof aiExtractionsService.extractSalesEvent>>
type GroundedResult = Awaited<ReturnType<typeof groundedAnswersService.answerQuestion>>

function checkpointObject(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

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
  activities: { select: { id: true, createdAt: true, kind: true, attemptCount: true, message: true, actorUserId: true },
    orderBy: { createdAt: 'desc' }, take: 100 },
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

async function operateWorkflowRun(params: {
  workflowRunId: string
  organizationId: string
  actorUserId: string
  action: 'retry' | 'cancel'
  reason?: string
}) {
  await prisma.$transaction(async tx => {
    const run = await tx.workflowRun.findFirst({
      where: { id: params.workflowRunId, organizationId: params.organizationId },
      select: { id: true, status: true, startedAt: true, leaseVersion: true, attemptCount: true,
        webhookEventId: true, reviewStatus: true, deliveryStatus: true },
    })
    if (!run) throw ApiError.notFound('Workflow run not found')
    if (params.action === 'retry') {
      if (!['FAILED', 'RETRY_WAIT'].includes(run.status) ||
        run.reviewStatus === 'APPROVED' || run.deliveryStatus === 'SENT') {
        throw ApiError.conflict('Workflow run cannot be retried from its current state')
      }
    } else if (!['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(run.status)) {
      throw ApiError.conflict('Workflow run cannot be cancelled from its current state')
    }
    const now = new Date()
    const updated = await tx.workflowRun.updateMany({
      where: { id: run.id, organizationId: params.organizationId, status: run.status,
        leaseVersion: run.leaseVersion },
      data: params.action === 'retry' ? {
        status: 'QUEUED', attemptCount: 0, startedAt: null, completedAt: null,
        nextAttemptAt: null, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null,
        leaseVersion: { increment: 1 }, reviewStatus: 'NOT_REQUESTED', reviewedAt: null,
        confidence: null,
      } : {
        status: 'CANCELLED', startedAt: run.startedAt ?? now, completedAt: now, nextAttemptAt: null,
        leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null,
        leaseVersion: { increment: 1 },
        errorMessage: params.reason ?? 'Cancelled by operator',
      },
    })
    if (updated.count !== 1) throw ApiError.conflict('Workflow run changed during operator action')
    await tx.workflowRunActivity.create({ data: {
      organizationId: params.organizationId, workflowRunId: run.id,
      kind: params.action === 'retry' ? 'RETRIED' : 'CANCELLED',
      attemptCount: run.attemptCount, actorUserId: params.actorUserId,
      message: params.reason ?? (params.action === 'retry' ? 'Manual retry requested' : 'Cancelled by operator'),
    } })
    if (run.webhookEventId) await tx.webhookEvent.update({
      where: { id: run.webhookEventId }, data: params.action === 'retry'
        ? { status: 'QUEUED', processedAt: null, errorMessage: null }
        : { status: 'IGNORED', processedAt: now, errorMessage: params.reason ?? 'Cancelled by operator' },
    })
  })
  return getWorkflowRunById(params.workflowRunId, params.organizationId)
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
          source: true,
          eventType: true,
          externalObjectType: true,
          payload: true,
        },
      },
    },
  })

  if (!workflowRun) throw ApiError.notFound('Workflow run not found')
  const gmailMessage = workflowRun.webhookEvent?.source === 'GMAIL' &&
    workflowRun.webhookEvent.eventType === 'EMAIL_RECEIVED' &&
    workflowRun.webhookEvent.externalObjectType === 'EMAIL'
    ? gmailReceivedSchema.shape.body.safeParse(workflowRun.webhookEvent.payload) : null
  const gmailEvent = gmailMessage?.success ? { id: workflowRun.webhookEvent!.id, message: gmailMessage.data } : null
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

      const previous = checkpointObject(workflowRun.output)
      const result: GroundedResult = previous?.kind === 'GROUNDED_ANSWER_PARTIAL' && previous.result
        ? previous.result as GroundedResult
        : await groundedAnswersService.answerQuestion(
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
      if (previous?.kind !== 'GROUNDED_ANSWER_PARTIAL') {
        const saved = await checkpointWorkflow(claim, { kind: 'GROUNDED_ANSWER_PARTIAL', result } as Prisma.InputJsonValue,
          'Grounded answer produced')
        if (!saved) throw ApiError.conflict('Workflow lease was lost before result checkpoint')
      }

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

    const previous = checkpointObject(workflowRun.output)
    const partial = previous?.kind === 'SALES_EVENT_PARTIAL' ? previous : null
    const result: SalesResult = partial?.result ? partial.result as SalesResult : await aiExtractionsService.extractSalesEvent(extractionInput, {
      organizationId: claim.organizationId,
      userId,
      workflowRunId: workflowRun.id,
      signal: abort.signal,
    })

    const groundedAnswers: Array<Record<string, unknown>> = partial && Array.isArray(partial.groundedAnswers)
      ? partial.groundedAnswers as Array<Record<string, unknown>> : []
    if (!partial) {
      const saved = await checkpointWorkflow(claim,
        { kind: 'SALES_EVENT_PARTIAL', result, groundedAnswers } as Prisma.InputJsonValue,
        'Sales extraction produced')
      if (!saved) throw ApiError.conflict('Workflow lease was lost before extraction checkpoint')
    }

    const extractedQuestions = result.extraction.buyerQuestions ?? []
    const buyerQuestions = gmailEvent
      ? extractedQuestions.map(question => question.trim().slice(0, 1000)).filter(question => question.length >= 3).slice(0, 3)
      : extractedQuestions
    
    if (buyerQuestions.length > 0) {
      for (let index = groundedAnswers.length; index < buyerQuestions.length; index += 1) {
        const question = buyerQuestions[index]!
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
          if (gmailEvent) console.error('Failed to prepare Gmail review answer')
          else console.error('Failed to get grounded answer for workflow question', error)
          groundedAnswers.push({ question, answer: null, refused: true, error: 'Answer processing failed', citations: [] })
        }
        const saved = await checkpointWorkflow(claim,
          { kind: 'SALES_EVENT_PARTIAL', result, groundedAnswers } as Prisma.InputJsonValue,
          `Buyer question ${index + 1} of ${buyerQuestions.length} recorded`)
        if (!saved) throw ApiError.conflict('Workflow lease was lost before question checkpoint')
      }
    }

    const draftId = gmailEvent ? await createGmailReviewTask({
      claim, eventId: gmailEvent.id, message: gmailEvent.message,
      answers: groundedAnswers.slice(0, 3) as GmailReviewAnswer[],
      issue: extractedQuestions.length > buyerQuestions.length ? 'Additional buyer questions need manual review' : undefined,
    }) : null
    if (gmailEvent && !draftId) throw ApiError.conflict('Workflow lease was lost before draft creation')
    const finalOutput = { ...result, groundedAnswers, ...(draftId && { draftId }) }

    await finalizeWorkflow(claim, {
        status: 'COMPLETED',
        reviewStatus: gmailEvent || groundedAnswers.some(answer => answer.refused) ? 'REQUIRED' : 'NOT_REQUESTED',
        confidence: result.extraction.confidence,
        output: finalOutput as unknown as Prisma.InputJsonValue,
        errorMessage: null,
    })
    return getWorkflowRunById(claim.id, claim.organizationId)
  } catch (err) {
    const message = gmailEvent ? 'Gmail review processing failed' :
      err instanceof Error && err.message.trim() ? err.message : 'Workflow processing failed'
    const retryable = !heartbeatLost && (signal?.aborted ||
      (err instanceof ProviderOperationError ? err.retryable : !(err instanceof ApiError) || err.statusCode >= 500))
    const willRetry = retryable && claim.attemptCount < claim.maxAttempts
    if (gmailEvent && !willRetry && !heartbeatLost && !signal?.aborted) {
      try {
        const draftId = await createGmailReviewTask({ claim, eventId: gmailEvent.id, message: gmailEvent.message,
          answers: [], issue: 'Email extraction failed; review the original message manually' })
        if (draftId) await checkpointWorkflow(claim, { kind: 'GMAIL_REVIEW_FAILURE', draftId }, 'Email review task needs manual work')
      } catch {
        console.error('Failed to record Gmail review task')
      }
    }
    await finalizeWorkflow(claim, {
      status: willRetry ? 'RETRY_WAIT' : 'FAILED',
      ...(gmailEvent && !willRetry && { reviewStatus: 'REQUIRED' }),
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
  operateWorkflowRun,
  processWorkflowRun,
  processNextQueuedWorkflowRun,
  processQueuedWorkflowRuns,
}
