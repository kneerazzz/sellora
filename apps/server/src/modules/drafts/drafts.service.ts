import { Prisma, type DraftRevisionOrigin } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { sha256Hex } from '../../utils/crypto'
import { ApiError } from '../../utils/apiError'
import { ProviderOperationError } from '../../services/provider/providerTransport'
import { groundedAnswersService } from '../groundedAnswers/groundedAnswers.service'
import { documentsService } from '../documents/documents.service'
import type {
  AppendDraftRevisionInput,
  ArchiveDraftInput,
  CreateDraftInput,
  ListDraftsQuery,
} from './drafts.schema'

type DraftContext = {
  organizationId: string
  userId: string
  requestId: string
  signal?: AbortSignal
}

type SourceReference = { documentId: string; versionId: string; chunkId: string }

const draftSummarySelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  title: true,
  question: true,
  processingStatus: true,
  reviewStatus: true,
  deliveryStatus: true,
  generationErrorCode: true,
  currentRevisionId: true,
  concurrencyToken: true,
  archivedAt: true,
  author: { select: { id: true, firstName: true, lastName: true } },
  currentRevision: {
    select: { id: true, revisionNumber: true, content: true, isRefusal: true, createdAt: true },
  },
} satisfies Prisma.DraftSelect

function normalizeCreateInput(input: CreateDraftInput) {
  return {
    question: input.question,
    title: input.title ?? null,
    documentIds: input.documentIds === undefined ? null : [...new Set(input.documentIds)].sort(),
    maxCitations: input.maxCitations ?? 5,
    draftText: input.draftText ?? null,
  }
}

function requestFingerprint(input: CreateDraftInput) {
  return sha256Hex(JSON.stringify(normalizeCreateInput(input)))
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function publicGenerationErrorCode(error: unknown) {
  if (error instanceof ProviderOperationError) {
    return `PROVIDER_${error.category.toUpperCase()}`
  }
  return 'GENERATION_FAILED'
}

async function assertSourceReferences(
  tx: Prisma.TransactionClient,
  organizationId: string,
  references: SourceReference[]
) {
  if (!references.length) return
  const unique = new Map(references.map(reference => [reference.chunkId, reference]))
  if (unique.size !== references.length) throw ApiError.conflict('Draft sources contain duplicate chunks')
  const chunks = await tx.documentChunk.findMany({
    where: {
      id: { in: [...unique.keys()] },
      document: { organizationId },
    },
    select: { id: true, documentId: true, versionId: true },
  })
  if (chunks.length !== references.length || chunks.some(chunk => {
    const expected = unique.get(chunk.id)
    return !expected || expected.documentId !== chunk.documentId || expected.versionId !== chunk.versionId
  })) throw ApiError.conflict('One or more draft sources are unavailable')
}

async function appendRevisionInTransaction(input: {
  draftId: string
  organizationId: string
  authorId: string
  content: string
  origin: DraftRevisionOrigin
  isRefusal: boolean
  aiInteractionId?: string
  sources: SourceReference[]
  expectedRevisionId?: string
}) {
  try {
    return await prisma.$transaction(async tx => {
      const draft = await tx.draft.findFirst({
        where: { id: input.draftId, organizationId: input.organizationId },
        select: { id: true, archivedAt: true, currentRevisionId: true, concurrencyToken: true },
      })
      if (!draft) throw ApiError.notFound('Draft not found')
      if (draft.archivedAt) throw ApiError.conflict('Archived drafts cannot be edited')
      if (input.expectedRevisionId !== undefined && draft.currentRevisionId !== input.expectedRevisionId) {
        throw ApiError.conflict('Draft changed; reload the current revision before saving')
      }
      if (input.expectedRevisionId === undefined && draft.currentRevisionId !== null) {
        throw ApiError.conflict('Draft already has a current revision')
      }
      await assertSourceReferences(tx, input.organizationId, input.sources)
      const revision = await tx.draftRevision.create({
        data: {
          draftId: draft.id,
          organizationId: input.organizationId,
          authorId: input.authorId,
          revisionNumber: draft.concurrencyToken + 1,
          content: input.content,
          origin: input.origin,
          isRefusal: input.isRefusal,
          aiInteractionId: input.aiInteractionId,
        },
      })
      if (input.sources.length) {
        await tx.draftRevisionSource.createMany({
          data: input.sources.map((source, ordinal) => ({
            ...source,
            ordinal,
            organizationId: input.organizationId,
            draftRevisionId: revision.id,
          })),
        })
      }
      const updated = await tx.draft.updateMany({
        where: {
          id: draft.id,
          organizationId: input.organizationId,
          currentRevisionId: draft.currentRevisionId,
          concurrencyToken: draft.concurrencyToken,
          archivedAt: null,
        },
        data: {
          currentRevisionId: revision.id,
          concurrencyToken: { increment: 1 },
          processingStatus: input.isRefusal ? 'REFUSED' : 'COMPLETED',
          reviewStatus: 'REQUIRED',
          generationErrorCode: null,
        },
      })
      if (updated.count !== 1) throw ApiError.conflict('Draft changed; reload before saving')
      return revision
    })
  } catch (error) {
    if (isUniqueConflict(error)) throw ApiError.conflict('Draft changed; reload before saving')
    throw error
  }
}

async function getDraftById(id: string, organizationId: string) {
  const draft = await prisma.draft.findFirst({
    where: { id, organizationId },
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      title: true,
      question: true,
      requestedDocumentIds: true,
      idempotencyKey: true,
      processingStatus: true,
      reviewStatus: true,
      deliveryStatus: true,
      generationErrorCode: true,
      currentRevisionId: true,
      concurrencyToken: true,
      archivedAt: true,
      author: { select: { id: true, firstName: true, lastName: true } },
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        select: {
          id: true,
          createdAt: true,
          revisionNumber: true,
          content: true,
          origin: true,
          isRefusal: true,
          aiInteractionId: true,
          author: { select: { id: true, firstName: true, lastName: true } },
          sources: {
            orderBy: { ordinal: 'asc' },
            select: { id: true, ordinal: true, documentId: true, versionId: true, chunkId: true },
          },
        },
      },
      approvals: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          decision: true,
          note: true,
          revisionId: true,
          reviewer: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
  })
  if (!draft) throw ApiError.notFound('Draft not found')
  const references = draft.revisions.flatMap(revision => revision.sources.map(source => ({
    documentId: source.documentId,
    versionId: source.versionId,
    chunkId: source.chunkId,
  })))
  const resolved = references.length
    ? await documentsService.resolveSourceReferences({ references }, organizationId)
    : []
  let sourceIndex = 0
  return {
    ...draft,
    revisions: draft.revisions.map(revision => ({
      ...revision,
      sources: revision.sources.map(source => ({
        id: source.id,
        ordinal: source.ordinal,
        ...resolved[sourceIndex++],
      })),
    })),
  }
}

async function createDraft(input: CreateDraftInput, context: DraftContext) {
  const normalized = normalizeCreateInput(input)
  const fingerprint = requestFingerprint(input)
  let draft: { id: string }
  try {
    draft = await prisma.draft.create({
      data: {
        organizationId: context.organizationId,
        authorId: context.userId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        title: normalized.title,
        question: normalized.question,
        requestedDocumentIds: normalized.documentIds ?? [],
      },
      select: { id: true },
    })
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const existing = await prisma.draft.findUnique({
      where: { organizationId_idempotencyKey: {
        organizationId: context.organizationId,
        idempotencyKey: input.idempotencyKey,
      } },
      select: { id: true, requestFingerprint: true },
    })
    if (!existing || existing.requestFingerprint !== fingerprint) {
      throw ApiError.conflict('Idempotency key was already used with different draft input')
    }
    return getDraftById(existing.id, context.organizationId)
  }

  try {
    if (normalized.draftText) {
      await appendRevisionInTransaction({
        draftId: draft.id,
        organizationId: context.organizationId,
        authorId: context.userId,
        content: normalized.draftText,
        origin: 'MANUAL',
        isRefusal: false,
        sources: [],
      })
    } else {
      const answer = await groundedAnswersService.answerQuestion({
        question: normalized.question,
        ...(normalized.documentIds !== null && { documentIds: normalized.documentIds }),
        maxCitations: normalized.maxCitations,
      }, {
        organizationId: context.organizationId,
        userId: context.userId,
        requestId: context.requestId,
        signal: context.signal,
      })
      await appendRevisionInTransaction({
        draftId: draft.id,
        organizationId: context.organizationId,
        authorId: context.userId,
        content: answer.answer,
        origin: 'GENERATED',
        isRefusal: answer.refused,
        aiInteractionId: answer.aiInteractionId,
        sources: answer.citations.map(citation => ({
          documentId: citation.documentId,
          versionId: citation.versionId,
          chunkId: citation.chunkId,
        })),
      })
    }
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 409) {
      await prisma.draft.updateMany({
        where: { id: draft.id, organizationId: context.organizationId, processingStatus: 'PROCESSING' },
        data: { processingStatus: 'FAILED', generationErrorCode: 'SOURCE_VALIDATION_FAILED' },
      })
    } else {
      await prisma.draft.updateMany({
        where: { id: draft.id, organizationId: context.organizationId, processingStatus: 'PROCESSING' },
        data: { processingStatus: 'FAILED', generationErrorCode: publicGenerationErrorCode(error) },
      })
    }
  }
  return getDraftById(draft.id, context.organizationId)
}

async function listDrafts(query: ListDraftsQuery, organizationId: string) {
  const page = query.page ?? 1
  const limit = query.limit ?? 20
  const archived = query.archived ?? 'active'
  const where: Prisma.DraftWhereInput = {
    organizationId,
    ...(archived === 'active' ? { archivedAt: null } : archived === 'archived' ? { archivedAt: { not: null } } : {}),
    ...(query.processingStatus && { processingStatus: query.processingStatus }),
    ...(query.search && { OR: [
      { title: { contains: query.search, mode: 'insensitive' } },
      { question: { contains: query.search, mode: 'insensitive' } },
    ] }),
  }
  const [items, total] = await prisma.$transaction([
    prisma.draft.findMany({
      where,
      select: draftSummarySelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.draft.count({ where }),
  ])
  const totalPages = Math.ceil(total / limit)
  return { items, page, limit, total, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 }
}

async function appendRevision(
  draftId: string,
  input: AppendDraftRevisionInput,
  context: Pick<DraftContext, 'organizationId' | 'userId'>
) {
  const current = await prisma.draftRevision.findFirst({
    where: { id: input.expectedRevisionId, draftId, organizationId: context.organizationId },
    include: { sources: { orderBy: { ordinal: 'asc' } } },
  })
  if (!current) {
    const draft = await prisma.draft.findFirst({ where: { id: draftId, organizationId: context.organizationId }, select: { id: true } })
    if (!draft) throw ApiError.notFound('Draft not found')
    throw ApiError.conflict('Expected revision is not the current draft revision')
  }
  await appendRevisionInTransaction({
    draftId,
    organizationId: context.organizationId,
    authorId: context.userId,
    content: input.content,
    origin: 'MANUAL',
    isRefusal: false,
    expectedRevisionId: input.expectedRevisionId,
    sources: current.sources.map(source => ({
      documentId: source.documentId,
      versionId: source.versionId,
      chunkId: source.chunkId,
    })),
  })
  return getDraftById(draftId, context.organizationId)
}

async function archiveDraft(draftId: string, input: ArchiveDraftInput, organizationId: string) {
  const updated = await prisma.draft.updateMany({
    where: {
      id: draftId,
      organizationId,
      concurrencyToken: input.expectedConcurrencyToken,
      archivedAt: null,
    },
    data: { archivedAt: new Date(), concurrencyToken: { increment: 1 } },
  })
  if (updated.count !== 1) {
    const draft = await prisma.draft.findFirst({ where: { id: draftId, organizationId }, select: { id: true } })
    if (!draft) throw ApiError.notFound('Draft not found')
    throw ApiError.conflict('Draft changed or is already archived; reload before archiving')
  }
  return getDraftById(draftId, organizationId)
}

export const draftsService = {
  createDraft,
  listDrafts,
  getDraftById,
  appendRevision,
  archiveDraft,
}
