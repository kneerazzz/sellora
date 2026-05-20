import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { apiKeysService } from './apiKeys.service'
import type { CreateApiKeyInput, ListApiKeysQuery } from './apiKeys.schema'

const createApiKey = asyncHandler(async (req: Request, res: Response) => {
  const result = await apiKeysService.createApiKey(
    req.body as CreateApiKeyInput,
    req.user.organizationId
  )

  res.status(201).json(
    ApiResponse.created('API key created successfully', {
      apiKey: result.apiKey,
      rawKey: result.rawKey,
    })
  )
})

const listApiKeys = asyncHandler(async (req: Request, res: Response) => {
  const result = await apiKeysService.listApiKeys(
    req.query as ListApiKeysQuery,
    req.user.organizationId
  )

  res.status(200).json(
    ApiResponse.ok('API keys fetched', result.items, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
      hasNextPage: result.hasNextPage,
      hasPrevPage: result.hasPrevPage,
    })
  )
})

const revokeApiKey = asyncHandler(async (req: Request, res: Response) => {
  const apiKey = await apiKeysService.revokeApiKey(
    req.params.id as string,
    req.user.organizationId
  )

  res.status(200).json(ApiResponse.ok('API key revoked successfully', apiKey))
})

export const apiKeysController = {
  createApiKey,
  listApiKeys,
  revokeApiKey,
}
