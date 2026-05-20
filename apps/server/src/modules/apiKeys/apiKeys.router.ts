import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { apiKeysController } from './apiKeys.controller'
import {
  apiKeyIdParamSchema,
  createApiKeySchema,
  listApiKeysSchema,
} from './apiKeys.schema'

export const apiKeysRouter = Router()

apiKeysRouter.use(authenticate)
apiKeysRouter.use(authorize('ADMIN', 'MANAGER'))

apiKeysRouter.post(
  '/',
  validate(createApiKeySchema),
  apiKeysController.createApiKey
)

apiKeysRouter.get(
  '/',
  validate(listApiKeysSchema),
  apiKeysController.listApiKeys
)

apiKeysRouter.delete(
  '/:id',
  validate(apiKeyIdParamSchema),
  apiKeysController.revokeApiKey
)
