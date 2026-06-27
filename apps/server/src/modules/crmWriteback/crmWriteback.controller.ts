import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { crmWritebackService } from './crmWriteback.service'
import type { CrmWritebackPreviewInput } from './crmWriteback.schema'

const previewCrmWriteback = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.user?.organizationId ?? req.apiKey?.organizationId
  if (!organizationId) {
    throw new Error('Organization ID is missing from request context')
  }

  const syncLog = await crmWritebackService.previewCrmWriteback(
    req.body as CrmWritebackPreviewInput,
    organizationId
  )

  res.status(201).json(ApiResponse.created('CRM writeback payload prepared', syncLog))
})

export const crmWritebackController = {
  previewCrmWriteback,
}
