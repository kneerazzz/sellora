import { z } from 'zod'

export const createApiKeySchema = z.object({
  body: z.object({
    label: z.string().trim().min(1, 'Label is required').max(120),
    scope: z
      .enum(['WEBHOOK_ONLY', 'READ_ONLY', 'FULL_ACCESS'])
      .default('WEBHOOK_ONLY'),
    expiresAt: z.coerce.date().optional(),
  }),
})

export const listApiKeysSchema = z.object({
  query: z.object({
    isActive: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  }),
})

export const apiKeyIdParamSchema = z.object({
  params: z.object({
    id: z.string().cuid('Invalid API key ID'),
  }),
})

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>['body']
export type ListApiKeysQuery = z.infer<typeof listApiKeysSchema>['query']
