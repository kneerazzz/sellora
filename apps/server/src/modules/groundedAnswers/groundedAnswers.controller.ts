import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { groundedAnswersService } from './groundedAnswers.service'
import type { GroundedAnswerInput } from './groundedAnswers.schema'

const answerQuestion = asyncHandler(async (req: Request, res: Response) => {
  const answer = await groundedAnswersService.answerQuestion(req.body as GroundedAnswerInput, {
    organizationId: req.user.organizationId,
    userId: req.user.id,
  })

  res.status(200).json(ApiResponse.ok('Grounded answer generated', answer))
})

export const groundedAnswersController = {
  answerQuestion,
}
