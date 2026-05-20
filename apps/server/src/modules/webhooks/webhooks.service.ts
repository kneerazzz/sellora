import {
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

async function intakeWebhookEvent(params: {
  input: WebhookEventInput
  eventType: WebhookEventType
  organizationId: string
  apiKeyId: string
}) {
  const { input, eventType, organizationId, apiKeyId } = params

  if (input.integrationId) {
    const integration = await prisma.integration.findFirst({
      where: { id: input.integrationId, organizationId },
      select: { id: true },
    })

    if (!integration) {
      throw ApiError.notFound('Integration not found')
    }
  }

  return prisma.$transaction(async (tx) => {
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
}

export const webhooksService = {
  intakeWebhookEvent,
}
