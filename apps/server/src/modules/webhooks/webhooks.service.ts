import {
  Prisma,
  WebhookEventType,
  WorkflowRunType,
  type ExternalObjectType,
  type WebhookEventSource,
} from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import type { WebhookEventInput } from './webhooks.schema'

function workflowTypeForEvent(eventType: WebhookEventType): WorkflowRunType {
  switch (eventType) {
    case 'EMAIL_RECEIVED':
    case 'EMAIL_SENT':
    case 'CALL_TRANSCRIPT_RECEIVED':
    case 'MEETING_LOGGED':
      return 'SALES_EVENT_EXTRACTION'
    case 'MANUAL_QUESTION':
      return 'GROUNDED_TECHNICAL_ANSWER'
    case 'CRM_RECORD_CREATED':
    case 'CRM_RECORD_UPDATED':
    case 'CRM_STAGE_CHANGED':
      return 'CRM_UPDATE_PREPARATION'
    default:
      return 'CUSTOM'
  }
}

async function findIdempotentWebhookEvent(
  organizationId: string,
  idempotencyKey: string
) {
  const existing = await prisma.webhookEvent.findFirst({
    where: { organizationId, idempotencyKey },
    select: {
      id: true,
      source: true,
      eventType: true,
      status: true,
      externalObjectType: true,
      externalObjectId: true,
      receivedAt: true,
      organizationId: true,
      workflowRuns: {
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          organizationId: true,
          webhookEventId: true,
        },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  })

  if (!existing?.workflowRuns[0]) {
    return null
  }

  const { workflowRuns, ...webhookEvent } = existing
  return { webhookEvent, workflowRun: workflowRuns[0] }
}

async function intakeWebhookEvent(params: {
  input: WebhookEventInput
  eventType: WebhookEventType
  organizationId: string
  apiKeyId: string
  idempotencyKey?: string
}) {
  const { input, eventType, organizationId, apiKeyId, idempotencyKey } = params

  if (input.integrationId) {
    const integration = await prisma.integration.findFirst({
      where: { id: input.integrationId, organizationId },
      select: { id: true },
    })

    if (!integration) {
      throw ApiError.notFound('Integration not found')
    }
  }

  if (idempotencyKey) {
    const existing = await findIdempotentWebhookEvent(organizationId, idempotencyKey)
    if (existing) return existing
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const webhookEvent = await tx.webhookEvent.create({
        data: {
          source: input.source as WebhookEventSource,
          eventType,
          externalObjectType: input.externalObjectType as ExternalObjectType | undefined,
          externalObjectId: input.externalObjectId,
          payload: input.payload as object,
          organizationId,
          apiKeyId,
          integrationId: input.integrationId,
          idempotencyKey,
        },
        select: {
          id: true,
          source: true,
          eventType: true,
          status: true,
          externalObjectType: true,
          externalObjectId: true,
          receivedAt: true,
          organizationId: true,
        },
      })

      const workflowRun = await tx.workflowRun.create({
        data: {
          type: workflowTypeForEvent(eventType),
          status: 'QUEUED',
          input: input.payload as object,
          organizationId,
          webhookEventId: webhookEvent.id,
        },
        select: {
          id: true,
          type: true,
          status: true,
          createdAt: true,
          organizationId: true,
          webhookEventId: true,
        },
      })

      return { webhookEvent, workflowRun }
    })
  } catch (error) {
    if (
      idempotencyKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await findIdempotentWebhookEvent(organizationId, idempotencyKey)
      if (existing) return existing
    }

    throw error
  }
}

function buildWebhookAcceptedResponse(result: Awaited<ReturnType<typeof intakeWebhookEvent>>) {
  return {
    webhookEventId: result.webhookEvent.id,
    workflowRunId: result.workflowRun.id,
    status: result.workflowRun.status,
    workflowType: result.workflowRun.type,
    processUrl: `/api/v1/workflow-runs/${result.workflowRun.id}/process`,
    webhookEvent: result.webhookEvent,
    workflowRun: result.workflowRun,
  }
}

export const webhooksService = {
  intakeWebhookEvent,
  buildWebhookAcceptedResponse,
}
