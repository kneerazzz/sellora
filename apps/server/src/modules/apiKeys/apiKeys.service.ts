import crypto from 'node:crypto'
import { ApiKeyScope, Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
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

function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex')
}

function generateApiKey(): string {
  return `sk_sellora_${crypto.randomBytes(32).toString('base64url')}`
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
      keyHash: hashApiKey(rawKey),
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
  const page = query.page ?? 1
  const limit = query.limit ?? 20
  const skip = (page - 1) * limit

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

  const totalPages = Math.ceil(total / limit)

  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }
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
