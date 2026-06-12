import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { crmWritebackController } from './crmWriteback.controller'
import { crmWritebackPreviewSchema } from './crmWriteback.schema'

export const crmWritebackRouter = Router()

crmWritebackRouter.use(authenticate)

crmWritebackRouter.post(
  '/preview',
  authorize('ADMIN', 'MANAGER'),
  validate(crmWritebackPreviewSchema),
  crmWritebackController.previewCrmWriteback
)
