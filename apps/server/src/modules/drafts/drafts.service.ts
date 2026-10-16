import { Prisma, type DraftRevisionOrigin } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { sha256Hex } from '../../utils/crypto'
import { ApiError } from '../../utils/apiError'
import { ProviderOperationError } from '../../services/provider/providerTransport'
import { groundedAnswersService } from '../groundedAnswers/groundedAnswers.service'
import { documentsService } from '../documents/documents.service'
import type {
  ApproveDraftInput,
  AppendDraftRevisionInput,
  ArchiveDraftInput,
  CreateDraftInput,
  ListDraftsQuery,
  RequestDraftExportInput,
} from './drafts.schema'

type DraftContext = {
  organizationId: string
  userId: string
  requestId: string
  signal?: AbortSignal
}

type SourceReference = { documentId: string; versionId: string; chunkId: string }

type LockedDraft = { id: string; currentRevisionId: string | null; concurrencyToken: number; archivedAt: Date | null; reviewStatus: string }

async function lockDraft(tx: Prisma.TransactionClient, draftId: string, organizationId: string) {
  const rows = await tx.$queryRaw<LockedDraft[]>(Prisma.sql`
    SELECT "id", "currentRevisionId", "concurrencyToken", "archivedAt", "reviewStatus"
    FROM "drafts" WHERE "id" = ${draftId} AND "organizationId" = ${organizationId} FOR UPDATE
  `)
  if (!rows[0]) throw ApiError.notFound('Draft not found')
  return rows[0]
}

async function lockSourceDocuments(tx: Prisma.TransactionClient, organizationId: string, sources: SourceReference[]) {
  const ids = [...new Set(sources.map(source => source.documentId))].sort()
  if (!ids.length) return
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "documents"
    WHERE "organizationId" = ${organizationId} AND "id" IN (${Prisma.join(ids)})
    ORDER BY "id" FOR SHARE
  `)
  if (locked.length !== ids.length) throw ApiError.conflict('One or more draft sources are unavailable')
}

async function sourceStates(tx: Prisma.TransactionClient, sources: SourceReference[], organizationId: string) {
  if (!sources.length) return { state: 'NO_SOURCES' as const, entries: [] as Array<Record<string, unknown>> }
  const resolved = await tx.draftRevisionSource.findMany({
    where: { organizationId, chunkId: { in: sources.map(source => source.chunkId) } },
    select: {
      documentId: true, versionId: true, chunkId: true,
      document: { select: { displayName: true, filename: true, status: true, deletedAt: true, activeVersionId: true } },
      version: { select: { status: true } },
      chunk: { select: { chunkIndex: true, pageNumber: true, headingPath: true, sectionTitle: true } },
    },
  })
  const byChunk = new Map(resolved.map(row => [row.chunkId, row]))
  const entries = sources.map(source => {
    const row = byChunk.get(source.chunkId)
    const matches = row && row.documentId === source.documentId && row.versionId === source.versionId
    const unavailable = !matches || row.document.deletedAt !== null || row.document.status === 'DELETED'
    const current = !unavailable && row.document.activeVersionId === source.versionId &&
      row.document.status === 'COMPLETED' && row.version.status === 'ACTIVE'
    return {
      ...source,
      availability: unavailable ? 'UNAVAILABLE' : current ? 'CURRENT' : 'STALE',
      ...(current && row ? {
        displayName: row.document.displayName,
        filename: row.document.filename,
        chunkIndex: row.chunk.chunkIndex,
        pageNumber: row.chunk.pageNumber,
        headingPath: row.chunk.headingPath,
        sectionTitle: row.chunk.sectionTitle,
      } : {}),
    }
  })
  const state = entries.some(entry => entry.availability === 'UNAVAILABLE') ? 'UNAVAILABLE'
    : entries.some(entry => entry.availability === 'STALE') ? 'STALE' : 'CURRENT'
  return { state, entries }
}

/** True only for the current, unarchived revision with an immutable approval and current sources. */
export async function isEffectiveDraftApproval(
  tx: Prisma.TransactionClient | typeof prisma,
  draftId: string,
  revisionId: string,
  organizationId: string
) {
  const draft = await tx.draft.findFirst({
    where: { id: draftId, organizationId },
    select: { currentRevisionId: true, reviewStatus: true, archivedAt: true },
  })
  if (!draft || draft.archivedAt || draft.currentRevisionId !== revisionId || draft.reviewStatus !== 'APPROVED') return false
  const approved = await tx.draftApproval.findFirst({
    where: { draftId, revisionId, organizationId, decision: 'APPROVED' }, select: { id: true },
  })
  if (!approved) return false
  const sources = await tx.draftRevisionSource.findMany({
    where: { draftRevisionId: revisionId, organizationId }, select: { documentId: true, versionId: true, chunkId: true },
  })
  return (await sourceStates(tx, sources, organizationId)).state === 'CURRENT' || sources.length === 0
}

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
  reusedApprovedAnswerId: true,
  reusedApprovedAnswerRevisionId: true,
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
      const draft = await lockDraft(tx, input.draftId, input.organizationId)
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
      reusedApprovedAnswerId: true,
      reusedApprovedAnswerRevisionId: true,
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

async function approveDraft(
  draftId: string,
  input: ApproveDraftInput,
  context: { organizationId: string; userId: string }
) {
  await prisma.$transaction(async tx => {
    const draft = await lockDraft(tx, draftId, context.organizationId)
    if (draft.archivedAt) throw ApiError.conflict('Archived drafts cannot be approved')
    if (draft.currentRevisionId !== input.revisionId) throw ApiError.conflict('Only the current revision can be approved')
    const revision = await tx.draftRevision.findFirst({
      where: { id: input.revisionId, draftId, organizationId: context.organizationId },
      select: { id: true, authorId: true, sources: { select: { documentId: true, versionId: true, chunkId: true } } },
    })
    if (!revision) throw ApiError.notFound('Draft revision not found')
    if (revision.authorId === context.userId) throw ApiError.forbidden('A revision author cannot approve their own revision')
    await lockSourceDocuments(tx, context.organizationId, revision.sources)
    const resolved = await sourceStates(tx, revision.sources, context.organizationId)
    if (resolved.state !== 'CURRENT' && revision.sources.length > 0) {
      throw ApiError.conflict('Draft sources must all be current before approval')
    }
    const effective = await isEffectiveDraftApproval(tx, draftId, input.revisionId, context.organizationId)
    if (effective) throw ApiError.conflict('This revision is already approved')
    await tx.draftApproval.create({ data: {
      organizationId: context.organizationId,
      draftId,
      revisionId: input.revisionId,
      reviewerId: context.userId,
      decision: 'APPROVED',
      note: input.note,
    } })
    const updated = await tx.draft.updateMany({
      where: { id: draftId, organizationId: context.organizationId, currentRevisionId: input.revisionId, archivedAt: null },
      data: { reviewStatus: 'APPROVED' },
    })
    if (updated.count !== 1) throw ApiError.conflict('Draft changed while approval was being recorded')
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
  return getDraftById(draftId, context.organizationId)
}

async function requestDraftExport(
  draftId: string,
  input: RequestDraftExportInput,
  context: { organizationId: string; userId: string }
) {
  return prisma.$transaction(async tx => {
    const draft = await lockDraft(tx, draftId, context.organizationId)
    if (draft.archivedAt) throw ApiError.conflict('Archived drafts cannot be exported')
    const revision = await tx.draftRevision.findFirst({
      where: { id: input.revisionId, draftId, organizationId: context.organizationId },
      select: { id: true, revisionNumber: true, content: true, isRefusal: true, sources: {
        orderBy: { ordinal: 'asc' }, select: { documentId: true, versionId: true, chunkId: true },
      } },
    })
    if (!revision) throw ApiError.notFound('Draft revision not found')
    await lockSourceDocuments(tx, context.organizationId, revision.sources)
    const resolved = await sourceStates(tx, revision.sources, context.organizationId)
    const approved = await isEffectiveDraftApproval(tx, draftId, revision.id, context.organizationId)
    if (input.approvedOnly && !approved) throw ApiError.conflict('This exact revision is not currently approved')
    const request = await tx.draftExportRequest.create({ data: {
      organizationId: context.organizationId,
      draftId,
      revisionId: revision.id,
      requesterId: context.userId,
      includeSources: input.includeSources,
    }, select: { id: true, createdAt: true } })
    const stale = resolved.state === 'STALE' || resolved.state === 'UNAVAILABLE'
    const sourceLines = input.includeSources ? resolved.entries.map((source, index) => {
      if (source.availability !== 'CURRENT') return `[${index + 1}] Source ${source.documentId}: ${String(source.availability).toLowerCase()}`
      const location = source.pageNumber != null ? `page ${source.pageNumber}`
        : source.sectionTitle ?? (Array.isArray(source.headingPath) ? source.headingPath.join(' › ') : '')
      return `[${index + 1}] ${source.displayName} (${location || `passage ${Number(source.chunkIndex) + 1}`})`
    }) : []
    return {
      exportId: request.id,
      requestedAt: request.createdAt,
      draftId,
      revisionId: revision.id,
      revisionNumber: revision.revisionNumber,
      approvalStatus: approved ? 'APPROVED' : 'UNAPPROVED',
      sourceStatus: resolved.state,
      archived: false,
      isRefusal: revision.isRefusal,
      content: revision.content,
      text: [
        stale ? 'NOTICE: One or more linked sources are stale or unavailable.' : '',
        approved ? 'Status: approved revision.' : 'Status: unapproved revision.',
        revision.content,
        ...(sourceLines.length ? ['', 'Sources:', ...sourceLines] : []),
      ].filter(Boolean).join('\n'),
    }
  })
}

async function confirmDraftCopy(
  draftId: string,
  exportId: string,
  context: { organizationId: string; userId: string }
) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "draft_export_requests"
      WHERE "id" = ${exportId} AND "draftId" = ${draftId}
        AND "organizationId" = ${context.organizationId} AND "requesterId" = ${context.userId}
      FOR UPDATE
    `)
    if (!rows[0]) throw ApiError.notFound('Export request not found')
    const existing = await tx.draftCopyConfirmation.findFirst({ where: { exportId }, select: { id: true, createdAt: true } })
    if (existing) throw ApiError.conflict('Copy success was already recorded for this export')
    return tx.draftCopyConfirmation.create({ data: { exportId }, select: { id: true, createdAt: true } })
  })
}

export const draftsService = {
  createDraft,
  listDrafts,
  getDraftById,
  appendRevision,
  archiveDraft,
  approveDraft,
  requestDraftExport,
  confirmDraftCopy,
}
