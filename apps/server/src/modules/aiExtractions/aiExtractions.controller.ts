import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { aiExtractionsService } from './aiExtractions.service'
import type { SalesExtractionInput } from './aiExtractions.schema'

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

export const aiExtractionsController = {
  extractSalesEvent,
}
