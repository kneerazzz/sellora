import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { questionnaireImportSchema } from './questionnaireImport'
import { questionnairesService } from './questionnaires.service'

export const questionnairesRouter = Router()
const idParams = z.object({ id: z.string().cuid() })

questionnairesRouter.use(authenticate, authorize('ADMIN', 'MANAGER', 'REP'))
questionnairesRouter.post('/', validate(z.object({ body: questionnaireImportSchema })), asyncHandler(async (req, res) => {
  const job = await questionnairesService.createJob(req.body, req.user.organizationId)
  res.status(201).json(ApiResponse.created('Questionnaire queued', job))
}))
questionnairesRouter.get('/:id', validate(z.object({ params: idParams })), asyncHandler(async (req, res) => {
  const job = await questionnairesService.getJob(req.params.id as string, req.user.organizationId)
  res.json(ApiResponse.ok('Questionnaire fetched', job))
}))
questionnairesRouter.post('/:id/cancel', validate(z.object({ params: idParams })), asyncHandler(async (req, res) => {
  const job = await questionnairesService.cancelJob(req.params.id as string, req.user.organizationId)
  res.json(ApiResponse.ok('Questionnaire cancelled', job))
}))
questionnairesRouter.post('/:id/rows/:rowIndex/retry', validate(z.object({ params: idParams.extend({ rowIndex: z.coerce.number().int().min(0) }) })), asyncHandler(async (req, res) => {
  const job = await questionnairesService.retryRow(req.params.id as string, Number(req.params.rowIndex), req.user.organizationId)
  res.json(ApiResponse.ok('Questionnaire row queued for retry', job))
}))
