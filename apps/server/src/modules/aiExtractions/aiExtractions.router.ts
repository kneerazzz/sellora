import { Router } from 'express'
import { authenticate } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { aiExtractionsController } from './aiExtractions.controller'
import { salesExtractionInputSchema } from './aiExtractions.schema'
import { rfpExtractionInputSchema } from './rfpExtraction.schema'

export const aiExtractionsRouter = Router()

aiExtractionsRouter.use(authenticate)

aiExtractionsRouter.post(
  '/sales-event',
  validate(salesExtractionInputSchema),
  aiExtractionsController.extractSalesEvent
)

aiExtractionsRouter.post(
  '/rfp',
  validate(rfpExtractionInputSchema),
  aiExtractionsController.extractAndAnswerRfp
)
