import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { workflowRunsController } from './workflowRuns.controller'
import {
  listWorkflowRunsSchema,
  processQueuedWorkflowRunsSchema,
  workflowRunIdParamSchema,
} from './workflowRuns.schema'

export const workflowRunsRouter = Router()

workflowRunsRouter.use(authenticate)

workflowRunsRouter.get(
  '/',
  validate(listWorkflowRunsSchema),
  workflowRunsController.listWorkflowRuns
)

workflowRunsRouter.post(
  '/process-next',
  authorize('ADMIN', 'MANAGER', 'REP'),
  workflowRunsController.processNextQueuedWorkflowRun
)

workflowRunsRouter.post(
  '/process-queued',
  authorize('ADMIN', 'MANAGER', 'REP'),
  validate(processQueuedWorkflowRunsSchema),
  workflowRunsController.processQueuedWorkflowRuns
)

workflowRunsRouter.get(
  '/:id',
  validate(workflowRunIdParamSchema),
  workflowRunsController.getWorkflowRunById
)

workflowRunsRouter.post(
  '/:id/process',
  authorize('ADMIN', 'MANAGER', 'REP'),
  validate(workflowRunIdParamSchema),
  workflowRunsController.processWorkflowRun
)
