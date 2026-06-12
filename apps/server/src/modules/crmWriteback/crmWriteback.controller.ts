import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { crmWritebackService } from './crmWriteback.service'
import type { CrmWritebackPreviewInput } from './crmWriteback.schema'

const previewCrmWriteback = asyncHandler(async (req: Request, res: Response) => {
  const syncLog = await crmWritebackService.previewCrmWriteback(
    req.body as CrmWritebackPreviewInput,
    req.user.organizationId
  )

  res.status(201).json(ApiResponse.created('CRM writeback payload prepared', syncLog))
})

export const crmWritebackController = {
  previewCrmWriteback,
}
