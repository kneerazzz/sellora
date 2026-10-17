import { Request, Response } from 'express'
import { WebhookEventType } from '@prisma/client'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { webhooksService } from './webhooks.service'
import { workflowRunsService } from '../workflowRuns/workflowRuns.service'
import { ApiError } from '../../utils/apiError'
import type { GmailReceivedInput, WebhookEventInput, WebhookEventQuery } from './webhooks.schema'

const DEFAULT_SYNC_PROCESS_TIMEOUT_MS = 25_000

function getIdempotencyKey(req: Request): string | undefined {
  const header = req.header('Idempotency-Key') ?? req.header('X-Idempotency-Key')
  const idempotencyKey = header?.trim()

  if (!idempotencyKey) {
    return undefined
  }

  if (idempotencyKey.length > 200) throw ApiError.badRequest('Idempotency-Key is too long')
  return idempotencyKey
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timeout: NodeJS.Timeout | undefined

  const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
    timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs)
  })

  const result = await Promise.race([
    promise.then((value) => ({ timedOut: false as const, value })),
    timeoutPromise,
  ])

  if (timeout) {
    clearTimeout(timeout)
  }

  return result
}

function createIntakeHandler(eventType: WebhookEventType) {
  return asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as WebhookEventQuery
    const idempotencyKey = getIdempotencyKey(req)
    const result = await webhooksService.intakeWebhookEvent({
      input: req.body as WebhookEventInput,
      eventType,
      organizationId: req.apiKey.organizationId,
      apiKeyId: req.apiKey.id,
      idempotencyKey,
    })

    const accepted = webhooksService.buildWebhookAcceptedResponse(result)

    if (!query.process) {
      res.status(202).json(ApiResponse.ok('Webhook event accepted', accepted))
      return
    }

    const processPromise = workflowRunsService.processWorkflowRun({
      workflowRunId: result.workflowRun.id,
      organizationId: req.apiKey.organizationId,
    })

    processPromise.catch(() => {})

    const processed = await withTimeout(
      processPromise,
      Number(process.env.WEBHOOK_SYNC_PROCESS_TIMEOUT_MS ?? DEFAULT_SYNC_PROCESS_TIMEOUT_MS)
    )

    if (processed.timedOut) {
      res.status(202).json(
        ApiResponse.ok('Webhook event accepted and processing', {
          ...accepted,
          status: 'RUNNING',
          workflowRun: {
            ...accepted.workflowRun,
            status: 'RUNNING',
          },
          result: null,
          pollUrl: `/api/v1/workflow-runs/${result.workflowRun.id}`,
        })
      )
      return
    }

    const workflowRun = processed.value

    if (workflowRun.status === 'RUNNING' || workflowRun.status === 'QUEUED' || workflowRun.status === 'RETRY_WAIT') {
      res.status(202).json(
        ApiResponse.ok('Webhook event accepted and processing', {
          ...accepted,
          status: workflowRun.status,
          workflowRun,
          result: null,
          pollUrl: `/api/v1/workflow-runs/${result.workflowRun.id}`,
        })
      )
      return
    }

    res.status(200).json(
      ApiResponse.ok('Webhook event accepted and processed', {
        ...accepted,
        status: workflowRun.status,
        workflowRun,
        result: workflowRun.output,
      })
    )
  })
}

export const webhooksController = {
  emailReceived: createIntakeHandler('EMAIL_RECEIVED'),
  gmailReceived: asyncHandler(async (req: Request, res: Response) => {
    if (req.header('Idempotency-Key') || req.header('X-Idempotency-Key')) {
      throw ApiError.badRequest('Gmail message ID is the idempotency key')
    }
    const message = req.body as GmailReceivedInput
    const result = await webhooksService.intakeWebhookEvent({
      input: { source: 'GMAIL', externalObjectType: 'EMAIL', externalObjectId: message.messageId,
        payload: message },
      eventType: 'EMAIL_RECEIVED', organizationId: req.apiKey.organizationId, apiKeyId: req.apiKey.id,
    })
    res.status(202).json(ApiResponse.ok('Gmail message accepted', {
      version: 1, ...webhooksService.buildWebhookAcceptedResponse(result),
    }))
  }),
  callTranscript: createIntakeHandler('CALL_TRANSCRIPT_RECEIVED'),
  crmEvent: createIntakeHandler('CRM_RECORD_UPDATED'),
  manualQuestion: createIntakeHandler('MANUAL_QUESTION'),
}
