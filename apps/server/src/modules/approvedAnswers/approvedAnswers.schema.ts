import { DraftReviewStatus } from '@prisma/client'
import { z } from 'zod'
import { env } from '../../config/env'

const answerIdParams = z.object({ id: z.string().cuid('Invalid approved answer ID') })
const tags = z.array(z.string().trim().min(1).max(60)).max(20).default([])
const sourceReference = z.object({
  documentId: z.string().cuid('Invalid document ID'),
  versionId: z.string().cuid('Invalid document version ID'),
  chunkId: z.string().cuid('Invalid document chunk ID'),
})

export const saveApprovedAnswerSchema = z.object({
  body: z.object({
    draftId: z.string().cuid('Invalid draft ID'),
    revisionId: z.string().cuid('Invalid revision ID'),
    title: z.string().trim().min(1).max(255),
    question: z.string().trim().min(1).max(env.PROVIDER_INPUT_MAX_CHARS).optional(),
    tags,
  }),
})

export const listApprovedAnswersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
    archived: z.enum(['active', 'archived', 'all']).default('active').optional(),
    reviewStatus: z.nativeEnum(DraftReviewStatus).optional(),
    search: z.string().trim().max(255).optional(),
  }),
})

export const approvedAnswerDetailSchema = z.object({ params: answerIdParams })

export const editApprovedAnswerSchema = z.object({
  params: answerIdParams,
  body: z.object({
    expectedRevisionId: z.string().cuid('Invalid revision ID'),
    title: z.string().trim().min(1).max(255).optional(),
    question: z.string().trim().min(1).max(env.PROVIDER_INPUT_MAX_CHARS).optional(),
    content: z.string().trim().min(1).max(env.PROVIDER_INPUT_MAX_CHARS).optional(),
    tags: tags.optional(),
    ownerId: z.string().cuid('Invalid owner ID').optional(),
    sources: z.array(sourceReference).min(1).max(50).optional(),
  }).refine(value => value.title !== undefined || value.question !== undefined ||
    value.content !== undefined || value.tags !== undefined || value.ownerId !== undefined ||
    value.sources !== undefined,
  'At least one approved answer field must change'),
})

export const approveApprovedAnswerSchema = z.object({
  params: answerIdParams,
  body: z.object({
    revisionId: z.string().cuid('Invalid revision ID'),
    note: z.string().trim().max(1000).optional(),
  }),
})

export const archiveApprovedAnswerSchema = z.object({
  params: answerIdParams,
  body: z.object({ expectedConcurrencyToken: z.coerce.number().int().min(1) }),
})

export const suggestApprovedAnswersSchema = z.object({
  query: z.object({
    question: z.string().trim().min(1).max(env.PROVIDER_INPUT_MAX_CHARS),
    limit: z.coerce.number().int().min(1).max(20).default(5).optional(),
  }),
})

export const reuseApprovedAnswerSchema = z.object({
  params: answerIdParams,
  body: z.object({
    expectedRevisionId: z.string().cuid('Invalid approved answer revision ID'),
    idempotencyKey: z.string().trim().min(8).max(200),
    question: z.string().trim().min(1).max(env.PROVIDER_INPUT_MAX_CHARS),
    title: z.string().trim().min(1).max(255).optional(),
  }),
})

export const approvedAnswerReviewQueueSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  }),
})

export type SaveApprovedAnswerInput = z.infer<typeof saveApprovedAnswerSchema>['body']
export type ListApprovedAnswersQuery = z.infer<typeof listApprovedAnswersSchema>['query']
export type EditApprovedAnswerInput = z.infer<typeof editApprovedAnswerSchema>['body']
export type ApproveApprovedAnswerInput = z.infer<typeof approveApprovedAnswerSchema>['body']
export type ArchiveApprovedAnswerInput = z.infer<typeof archiveApprovedAnswerSchema>['body']
export type SuggestApprovedAnswersQuery = z.infer<typeof suggestApprovedAnswersSchema>['query']
export type ReuseApprovedAnswerInput = z.infer<typeof reuseApprovedAnswerSchema>['body']
export type ApprovedAnswerReviewQueueQuery = z.infer<typeof approvedAnswerReviewQueueSchema>['query']
