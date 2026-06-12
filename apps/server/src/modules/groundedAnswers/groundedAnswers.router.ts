import { Router } from 'express'
import { authenticate } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { groundedAnswersController } from './groundedAnswers.controller'
import { groundedAnswerSchema } from './groundedAnswers.schema'

export const groundedAnswersRouter = Router()

groundedAnswersRouter.use(authenticate)

groundedAnswersRouter.post(
  '/',
  validate(groundedAnswerSchema),
  groundedAnswersController.answerQuestion
)
