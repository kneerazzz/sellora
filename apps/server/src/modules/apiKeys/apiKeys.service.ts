import { ApiKeyScope, Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { randomBase64Url, sha256Hex } from '../../utils/crypto'
import { buildPaginatedResult, getPaginationParams } from '../../utils/pagination'
import type { PaginatedResult } from '../../types/pagination.types'
import type { CreateApiKeyInput, ListApiKeysQuery } from './apiKeys.schema'

const apiKeySelect = {
  id: true,
  createdAt: true,
  label: true,
  keyPrefix: true,
  scope: true,
  isActive: true,
  expiresAt: true,
  lastUsedAt: true,
  usageCount: true,
  organizationId: true,
} satisfies Prisma.ApiKeySelect

export type ApiKeyPayload = Prisma.ApiKeyGetPayload<{ select: typeof apiKeySelect }>

function generateApiKey(): string {
  return `sk_sellora_${randomBase64Url(32)}`
}

async function createApiKey(
  input: CreateApiKeyInput,
  organizationId: string
): Promise<{ apiKey: ApiKeyPayload; rawKey: string }> {
  if (input.expiresAt && input.expiresAt <= new Date()) {
    throw ApiError.badRequest('API key expiration must be in the future')
  }

  const rawKey = generateApiKey()
  const apiKey = await prisma.apiKey.create({
    data: {
      label: input.label,
      scope: input.scope as ApiKeyScope,
      expiresAt: input.expiresAt,
      keyHash: sha256Hex(rawKey),
      keyPrefix: rawKey.slice(0, 18),
      organizationId,
    },
    select: apiKeySelect,
  })

  return { apiKey, rawKey }
}

async function listApiKeys(
  query: ListApiKeysQuery,
  organizationId: string
): Promise<PaginatedResult<ApiKeyPayload>> {
  const { page, limit, skip } = getPaginationParams(query)

  const where: Prisma.ApiKeyWhereInput = {
    organizationId,
    ...(typeof query.isActive === 'boolean' && { isActive: query.isActive }),
  }

  const [items, total] = await prisma.$transaction([
    prisma.apiKey.findMany({
      where,
      select: apiKeySelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.apiKey.count({ where }),
  ])

  return buildPaginatedResult({ items, total, page, limit })
}

async function revokeApiKey(
  apiKeyId: string,
  organizationId: string
): Promise<ApiKeyPayload> {
  const apiKey = await prisma.apiKey.findFirst({
    where: { id: apiKeyId, organizationId },
    select: { id: true, isActive: true },
  })

  if (!apiKey) {
    throw ApiError.notFound('API key not found')
  }

  if (!apiKey.isActive) {
    throw ApiError.badRequest('API key is already revoked')
  }

  return prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { isActive: false },
    select: apiKeySelect,
  })
}

export const apiKeysService = {
  createApiKey,
  listApiKeys,
  revokeApiKey,
}
