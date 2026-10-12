import { Router } from 'express'
import { z } from 'zod'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { asyncHandler } from '../../utils/asyncHandler'
import { ApiResponse } from '../../utils/apiResponse'
import { getUsageSummary, setUsagePause } from './usageControls.service'

export const usageControlsRouter = Router()
usageControlsRouter.use(authenticate, authorize('ADMIN', 'MANAGER'))

usageControlsRouter.get('/summary', asyncHandler(async (req, res) => {
  const summary = await getUsageSummary(req.user.organizationId)
  res.json(ApiResponse.ok('Usage summary fetched', summary))
}))

usageControlsRouter.put('/pause', authorize('ADMIN'), asyncHandler(async (req, res) => {
  const input = z.object({ paused: z.boolean() }).strict().parse(req.body)
  const control = await setUsagePause(req.user.organizationId, req.user.id, input.paused)
  res.json(ApiResponse.ok('Usage control updated', { paused: control.paused }))
}))
