import { Router } from 'express'
import { authenticateJwtOrApiKey } from '../../middleware/auth.middleware'
import { apiKeyRateLimit } from '../../middleware/apiKeyRateLimit.middleware'
import { validate } from '../../middleware/validate.middleware'
import { crmWritebackController } from './crmWriteback.controller'
import { crmWritebackPreviewSchema } from './crmWriteback.schema'

export const crmWritebackRouter = Router()

crmWritebackRouter.post(
  '/preview',
  authenticateJwtOrApiKey('WEBHOOK_ONLY', 'FULL_ACCESS'),
  apiKeyRateLimit(),
  validate(crmWritebackPreviewSchema),
  crmWritebackController.previewCrmWriteback
)
