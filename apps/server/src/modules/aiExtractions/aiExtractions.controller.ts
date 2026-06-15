import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { aiExtractionsService } from './aiExtractions.service'
import type { SalesExtractionInput } from './aiExtractions.schema'
import type { RfpExtractionInput } from './rfpExtraction.schema'

const extractSalesEvent = asyncHandler(async (req: Request, res: Response) => {
  const result = await aiExtractionsService.extractSalesEvent(
    req.body as SalesExtractionInput,
    {
      organizationId: req.user.organizationId,
      userId: req.user.id,
    }
  )

  res.status(200).json(ApiResponse.ok('Sales event extracted', result))
})

const extractAndAnswerRfp = asyncHandler(async (req: Request, res: Response) => {
  const result = await aiExtractionsService.extractAndAnswerRfp(
    req.body as RfpExtractionInput,
    {
      organizationId: req.user.organizationId,
      userId: req.user.id,
    }
  )

  res.status(200).json(ApiResponse.ok('RFP extracted and answered', result))
})

export const aiExtractionsController = {
  extractSalesEvent,
  extractAndAnswerRfp,
}
