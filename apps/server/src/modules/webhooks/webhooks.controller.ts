import { Request, Response } from 'express'
import { WebhookEventType } from '@prisma/client'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { webhooksService } from './webhooks.service'
import { workflowRunsService } from '../workflowRuns/workflowRuns.service'
import type { WebhookEventInput, WebhookEventQuery } from './webhooks.schema'

function createIntakeHandler(eventType: WebhookEventType) {
  return asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as WebhookEventQuery
    const result = await webhooksService.intakeWebhookEvent({
      input: req.body as WebhookEventInput,
      eventType,
      organizationId: req.apiKey.organizationId,
      apiKeyId: req.apiKey.id,
    })

    const accepted = webhooksService.buildWebhookAcceptedResponse(result)

    if (!query.process) {
      res.status(202).json(ApiResponse.ok('Webhook event accepted', accepted))
      return
    }

    const workflowRun = await workflowRunsService.processWorkflowRun({
      workflowRunId: result.workflowRun.id,
      organizationId: req.apiKey.organizationId,
    })

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
  callTranscript: createIntakeHandler('CALL_TRANSCRIPT_RECEIVED'),
  crmEvent: createIntakeHandler('CRM_RECORD_UPDATED'),
  manualQuestion: createIntakeHandler('MANUAL_QUESTION'),
}
