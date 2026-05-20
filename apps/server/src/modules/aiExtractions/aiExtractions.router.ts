import { Router } from 'express'
import { authenticate } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { aiExtractionsController } from './aiExtractions.controller'
import { salesExtractionInputSchema } from './aiExtractions.schema'

export const aiExtractionsRouter = Router()

aiExtractionsRouter.use(authenticate)

aiExtractionsRouter.post(
  '/sales-event',
  validate(salesExtractionInputSchema),
  aiExtractionsController.extractSalesEvent
)
