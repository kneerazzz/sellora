import { Request, Response } from 'express'
import { WebhookEventType } from '@prisma/client'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { webhooksService } from './webhooks.service'
import type { WebhookEventInput } from './webhooks.schema'

function createIntakeHandler(eventType: WebhookEventType) {
  return asyncHandler(async (req: Request, res: Response) => {
    const result = await webhooksService.intakeWebhookEvent({
      input: req.body as WebhookEventInput,
      eventType,
      organizationId: req.apiKey.organizationId,
      apiKeyId: req.apiKey.id,
    })

    res.status(202).json(ApiResponse.ok('Webhook event accepted', result))
  })
}

export const webhooksController = {
  emailReceived: createIntakeHandler('EMAIL_RECEIVED'),
  callTranscript: createIntakeHandler('CALL_TRANSCRIPT_RECEIVED'),
  crmEvent: createIntakeHandler('CRM_RECORD_UPDATED'),
  manualQuestion: createIntakeHandler('MANUAL_QUESTION'),
}
