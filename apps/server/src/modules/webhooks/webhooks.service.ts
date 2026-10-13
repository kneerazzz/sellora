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
import { isSupportedWorkflowType } from '../workflowRuns/workflowState'
import { workflowLeasePolicy } from '../workflowRuns/workflowLease'
import { isDeepStrictEqual } from 'node:util'

const externalKeyPrefix = '__external__:'

function resolvedIdempotencyKey(input: WebhookEventInput, headerKey?: string) {
  if (headerKey) {
    if (headerKey.length > 200 || headerKey.startsWith(externalKeyPrefix)) {
      throw ApiError.badRequest('Invalid Idempotency-Key')
    }
    return headerKey
  }
  return input.externalObjectId
    ? `${externalKeyPrefix}${input.externalObjectType ?? 'OTHER'}:${input.externalObjectId}`
    : undefined
}

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
  source: WebhookEventSource,
  eventType: WebhookEventType,
  input: WebhookEventInput,
  idempotencyKey: string
) {
  const existing = await prisma.webhookEvent.findFirst({
    where: { organizationId, source, eventType, idempotencyKey },
    select: {
      id: true,
      source: true,
      eventType: true,
      status: true,
      externalObjectType: true,
      externalObjectId: true,
      receivedAt: true,
      organizationId: true,
      payload: true,
      integrationId: true,
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

  if (!existing) return null
  if (!isDeepStrictEqual(existing.payload, input.payload) ||
    existing.externalObjectType !== (input.externalObjectType ?? null) ||
    existing.externalObjectId !== (input.externalObjectId ?? null) ||
    existing.integrationId !== (input.integrationId ?? null)) {
    throw ApiError.conflict('Idempotency key was already used for different event content')
  }
  if (!existing.workflowRuns[0]) throw ApiError.conflict('Idempotent event has no workflow run')

  const { workflowRuns, payload: _payload, integrationId: _integrationId, ...webhookEvent } = existing
  return { webhookEvent, workflowRun: workflowRuns[0] }
}

async function intakeWebhookEvent(params: {
  input: WebhookEventInput
  eventType: WebhookEventType
  organizationId: string
  apiKeyId: string
  idempotencyKey?: string
}) {
  const { input, eventType, organizationId, apiKeyId } = params
  const idempotencyKey = resolvedIdempotencyKey(input, params.idempotencyKey)
  const workflowType = workflowTypeForEvent(eventType)
  if (!isSupportedWorkflowType(workflowType)) {
    throw ApiError.badRequest(`Webhook event type ${eventType} has no supported workflow processor`)
  }

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
    const existing = await findIdempotentWebhookEvent(organizationId, input.source as WebhookEventSource, eventType, input, idempotencyKey)
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
          type: workflowType,
          status: 'QUEUED',
          maxAttempts: workflowLeasePolicy.maxAttempts,
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

      await tx.workflowRunActivity.create({ data: {
        organizationId, workflowRunId: workflowRun.id, kind: 'RECEIVED', attemptCount: 0,
      } })

      return { webhookEvent, workflowRun }
    })
  } catch (error) {
    if (
      idempotencyKey &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const existing = await findIdempotentWebhookEvent(organizationId, input.source as WebhookEventSource, eventType, input, idempotencyKey)
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
