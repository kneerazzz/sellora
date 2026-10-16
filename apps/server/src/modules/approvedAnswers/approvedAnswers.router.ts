import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { approvedAnswersController } from './approvedAnswers.controller'
import {
  approveApprovedAnswerSchema,
  approvedAnswerReviewQueueSchema,
  approvedAnswerDetailSchema,
  archiveApprovedAnswerSchema,
  editApprovedAnswerSchema,
  listApprovedAnswersSchema,
  saveApprovedAnswerSchema,
  suggestApprovedAnswersSchema,
  reuseApprovedAnswerSchema,
} from './approvedAnswers.schema'

export const approvedAnswersRouter = Router()

approvedAnswersRouter.use(authenticate, authorize('ADMIN', 'MANAGER', 'REP'))
approvedAnswersRouter.get('/', validate(listApprovedAnswersSchema), approvedAnswersController.listApprovedAnswers)
approvedAnswersRouter.get('/suggestions', validate(suggestApprovedAnswersSchema), approvedAnswersController.suggestApprovedAnswers)
approvedAnswersRouter.get('/review-queue', validate(approvedAnswerReviewQueueSchema),
  approvedAnswersController.listApprovedAnswerReviewQueue)
approvedAnswersRouter.post('/', validate(saveApprovedAnswerSchema), approvedAnswersController.saveApprovedAnswer)
approvedAnswersRouter.get('/:id', validate(approvedAnswerDetailSchema), approvedAnswersController.getApprovedAnswer)
approvedAnswersRouter.post('/:id/revisions', validate(editApprovedAnswerSchema), approvedAnswersController.editApprovedAnswer)
approvedAnswersRouter.post('/:id/approvals', authorize('ADMIN', 'MANAGER'),
  validate(approveApprovedAnswerSchema), approvedAnswersController.approveApprovedAnswer)
approvedAnswersRouter.post('/:id/reuse', validate(reuseApprovedAnswerSchema), approvedAnswersController.reuseApprovedAnswer)
approvedAnswersRouter.delete('/:id', validate(archiveApprovedAnswerSchema), approvedAnswersController.archiveApprovedAnswer)
