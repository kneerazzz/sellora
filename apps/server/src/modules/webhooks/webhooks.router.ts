import { Router } from 'express'
import { authenticateApiKey } from '../../middleware/auth.middleware'
import { apiKeyRateLimit } from '../../middleware/apiKeyRateLimit.middleware'
import { validate } from '../../middleware/validate.middleware'
import { webhooksController } from './webhooks.controller'
import { webhookEventBodySchema } from './webhooks.schema'

export const webhooksRouter = Router()

webhooksRouter.use(authenticateApiKey('WEBHOOK_ONLY', 'FULL_ACCESS'))
webhooksRouter.use(apiKeyRateLimit())

webhooksRouter.post(
  '/email-received',
  validate(webhookEventBodySchema),
  webhooksController.emailReceived
)

webhooksRouter.post(
  '/call-transcript',
  validate(webhookEventBodySchema),
  webhooksController.callTranscript
)

webhooksRouter.post(
  '/crm-event',
  validate(webhookEventBodySchema),
  webhooksController.crmEvent
)

webhooksRouter.post(
  '/manual-question',
  validate(webhookEventBodySchema),
  webhooksController.manualQuestion
)
