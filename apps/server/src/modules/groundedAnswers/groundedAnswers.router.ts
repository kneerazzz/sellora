import { Router } from 'express'
import { authenticateJwtOrApiKey } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { groundedAnswersController } from './groundedAnswers.controller'
import { groundedAnswerSchema } from './groundedAnswers.schema'

export const groundedAnswersRouter = Router()

groundedAnswersRouter.post(
  '/',
  authenticateJwtOrApiKey('READ_ONLY', 'FULL_ACCESS'),
  validate(groundedAnswerSchema),
  groundedAnswersController.answerQuestion
)
