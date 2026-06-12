import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { normalizeWebhookPayloadForExtraction } from '../../utils/aiExtraction'
import { buildPaginatedResult, getPaginationParams } from '../../utils/pagination'
import { aiExtractionsService } from '../aiExtractions/aiExtractions.service'
import { groundedAnswersService } from '../groundedAnswers/groundedAnswers.service'
import type { PaginatedResult } from '../../types/pagination.types'
import type { ListWorkflowRunsQuery } from './workflowRuns.schema'

const workflowRunListSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  type: true,
  status: true,
  confidence: true,
  startedAt: true,
  completedAt: true,
  errorMessage: true,
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

async function processWorkflowRun(params: {
  workflowRunId: string
  organizationId: string
  userId?: string
}) {
  const workflowRun = await prisma.workflowRun.findFirst({
    where: {
      id: params.workflowRunId,
      organizationId: params.organizationId,
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

  if (!workflowRun) {
    throw ApiError.notFound('Workflow run not found')
  }

  if (workflowRun.status === 'COMPLETED') {
    throw ApiError.badRequest('Workflow run has already been completed')
  }

  if (workflowRun.status === 'RUNNING') {
    throw ApiError.badRequest('Workflow run is already running')
  }

  if (
    workflowRun.type !== 'SALES_EVENT_EXTRACTION' &&
    workflowRun.type !== 'GROUNDED_TECHNICAL_ANSWER'
  ) {
    throw ApiError.badRequest(`Workflow type ${workflowRun.type} is not supported yet`)
  }

  await prisma.workflowRun.update({
    where: { id: workflowRun.id },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
      errorMessage: null,
    },
  })

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
          organizationId: params.organizationId,
          userId: params.userId,
        }
      )

      const updated = await prisma.workflowRun.update({
        where: { id: workflowRun.id },
        data: {
          status: result.refused ? 'NEEDS_REVIEW' : 'COMPLETED',
          confidence: result.confidence,
          output: result as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
          errorMessage: null,
        },
        select: {
          id: true,
          type: true,
          status: true,
          confidence: true,
          input: true,
          output: true,
          startedAt: true,
          completedAt: true,
          errorMessage: true,
          organizationId: true,
          webhookEventId: true,
        },
      })

      if (workflowRun.webhookEventId) {
        await prisma.webhookEvent.update({
          where: { id: workflowRun.webhookEventId },
          data: {
            status: result.refused ? 'IGNORED' : 'COMPLETED',
            processedAt: new Date(),
            errorMessage: result.refused ? 'Insufficient grounded document context' : null,
          },
        })
      }

      return updated
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
      organizationId: params.organizationId,
      userId: params.userId,
    })

    const updated = await prisma.workflowRun.update({
      where: { id: workflowRun.id },
      data: {
        status: 'COMPLETED',
        confidence: result.extraction.confidence,
        output: result as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        errorMessage: null,
      },
      select: {
        id: true,
        type: true,
        status: true,
        confidence: true,
        input: true,
        output: true,
        startedAt: true,
        completedAt: true,
        errorMessage: true,
        organizationId: true,
        webhookEventId: true,
      },
    })

    if (workflowRun.webhookEventId) {
      await prisma.webhookEvent.update({
        where: { id: workflowRun.webhookEventId },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          errorMessage: null,
        },
      })
    }

    return updated
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Workflow processing failed'

    await prisma.workflowRun.update({
      where: { id: workflowRun.id },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        errorMessage: message,
      },
    })

    if (workflowRun.webhookEventId) {
      await prisma.webhookEvent.update({
        where: { id: workflowRun.webhookEventId },
        data: {
          status: 'FAILED',
          processedAt: new Date(),
          errorMessage: message,
        },
      })
    }

    throw err
  }
}

async function processNextQueuedWorkflowRun(params: {
  organizationId?: string
  userId?: string
}) {
  const workflowRun = await prisma.workflowRun.findFirst({
    where: {
      status: 'QUEUED',
      type: { in: ['SALES_EVENT_EXTRACTION', 'GROUNDED_TECHNICAL_ANSWER'] },
      ...(params.organizationId && { organizationId: params.organizationId }),
    },
    select: {
      id: true,
      organizationId: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  if (!workflowRun) {
    return null
  }

  return processWorkflowRun({
    workflowRunId: workflowRun.id,
    organizationId: workflowRun.organizationId,
    userId: params.userId,
  })
}

async function processQueuedWorkflowRuns(params: {
  organizationId?: string
  userId?: string
  limit?: number
}) {
  const limit = params.limit ?? 10
  const processed = []

  for (let index = 0; index < limit; index += 1) {
    const workflowRun = await processNextQueuedWorkflowRun({
      organizationId: params.organizationId,
      userId: params.userId,
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
