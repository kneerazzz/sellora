import { Router } from 'express'
import { authenticate, authenticateJwtOrApiKey, authorize } from '../../middleware/auth.middleware'
import { apiKeyRateLimit } from '../../middleware/apiKeyRateLimit.middleware'
import { validate } from '../../middleware/validate.middleware'
import { workflowRunsController } from './workflowRuns.controller'
import {
  listWorkflowRunsSchema,
  processQueuedWorkflowRunsSchema,
  workflowRunIdParamSchema,
} from './workflowRuns.schema'

export const workflowRunsRouter = Router()

workflowRunsRouter.get(
  '/',
  authenticateJwtOrApiKey('WEBHOOK_ONLY', 'FULL_ACCESS'),
  apiKeyRateLimit(),
  validate(listWorkflowRunsSchema),
  workflowRunsController.listWorkflowRuns
)

workflowRunsRouter.post(
  '/process-next',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'REP'),
  workflowRunsController.processNextQueuedWorkflowRun
)

workflowRunsRouter.post(
  '/process-queued',
  authenticate,
  authorize('ADMIN', 'MANAGER', 'REP'),
  validate(processQueuedWorkflowRunsSchema),
  workflowRunsController.processQueuedWorkflowRuns
)

workflowRunsRouter.get(
  '/:id',
  authenticateJwtOrApiKey('WEBHOOK_ONLY', 'FULL_ACCESS'),
  apiKeyRateLimit(),
  validate(workflowRunIdParamSchema),
  workflowRunsController.getWorkflowRunById
)

workflowRunsRouter.post(
  '/:id/process',
  authenticateJwtOrApiKey('WEBHOOK_ONLY', 'FULL_ACCESS'),
  apiKeyRateLimit(),
  validate(workflowRunIdParamSchema),
  workflowRunsController.processWorkflowRun
)
