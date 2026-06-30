import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { aiExtractionsService } from './aiExtractions.service'
import type { SalesExtractionInput } from './aiExtractions.schema'
import type { RfpExtractionInput } from './rfpExtraction.schema'

const extractSalesEvent = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.user?.organizationId || req.apiKey?.organizationId
  if (!orgId) throw new Error('Organization ID is missing')

  const result = await aiExtractionsService.extractSalesEvent(
    req.body as SalesExtractionInput,
    {
      organizationId: orgId,
      userId: req.user?.id,
    }
  )

  res.status(200).json(ApiResponse.ok('Sales event extracted', result))
})

const extractAndAnswerRfp = asyncHandler(async (req: Request, res: Response) => {
  const orgId = req.user?.organizationId || req.apiKey?.organizationId
  if (!orgId) throw new Error('Organization ID is missing')

  const result = await aiExtractionsService.extractAndAnswerRfp(
    req.body as RfpExtractionInput,
    {
      organizationId: orgId,
      userId: req.user?.id,
    }
  )

  res.status(200).json(ApiResponse.ok('RFP extracted and answered', result))
})

export const aiExtractionsController = {
  extractSalesEvent,
  extractAndAnswerRfp,
}
