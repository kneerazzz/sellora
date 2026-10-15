import { z } from 'zod'
import { DraftProcessingStatus } from '@prisma/client'
import { env } from '../../config/env'

const draftIdParams = z.object({
  id: z.string().cuid('Invalid draft ID'),
})

export const createDraftSchema = z.object({
  body: z.object({
    idempotencyKey: z.string().trim().min(8).max(200),
    question: z.string().trim().min(1).max(env.PROVIDER_INPUT_MAX_CHARS),
    title: z.string().trim().min(1).max(255).optional(),
    documentIds: z.array(z.string().cuid('Invalid document ID')).max(50).optional(),
    maxCitations: z.coerce.number().int().min(1).max(10).default(5).optional(),
    draftText: z.string().trim().min(1).max(env.PROVIDER_INPUT_MAX_CHARS).optional(),
  }),
})

export const listDraftsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
    processingStatus: z.nativeEnum(DraftProcessingStatus).optional(),
    archived: z.enum(['active', 'archived', 'all']).default('active').optional(),
    search: z.string().trim().max(255).optional(),
  }),
})

export const draftDetailSchema = z.object({ params: draftIdParams })

export const appendDraftRevisionSchema = z.object({
  params: draftIdParams,
  body: z.object({
    expectedRevisionId: z.string().cuid('Invalid revision ID'),
    content: z.string().trim().min(1).max(env.PROVIDER_INPUT_MAX_CHARS),
  }),
})

export const archiveDraftSchema = z.object({
  params: draftIdParams,
  body: z.object({
    expectedConcurrencyToken: z.coerce.number().int().min(0),
  }),
})

export const approveDraftSchema = z.object({
  params: draftIdParams,
  body: z.object({ revisionId: z.string().cuid('Invalid revision ID'), note: z.string().trim().max(1000).optional() }),
})

export const requestDraftExportSchema = z.object({
  params: draftIdParams,
  body: z.object({
    revisionId: z.string().cuid('Invalid revision ID'),
    includeSources: z.boolean().default(false),
    approvedOnly: z.boolean().default(false),
  }),
})

export const confirmDraftCopySchema = z.object({
  params: z.object({ id: z.string().cuid('Invalid draft ID'), exportId: z.string().cuid('Invalid export ID') }),
  body: z.object({}),
})

export type CreateDraftInput = z.infer<typeof createDraftSchema>['body']
export type ListDraftsQuery = z.infer<typeof listDraftsSchema>['query']
export type AppendDraftRevisionInput = z.infer<typeof appendDraftRevisionSchema>['body']
export type ArchiveDraftInput = z.infer<typeof archiveDraftSchema>['body']
export type ApproveDraftInput = z.infer<typeof approveDraftSchema>['body']
export type RequestDraftExportInput = z.infer<typeof requestDraftExportSchema>['body']
