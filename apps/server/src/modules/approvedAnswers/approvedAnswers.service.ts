import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { sha256Hex } from '../../utils/crypto'
import { documentsService } from '../documents/documents.service'
import { draftsService, isEffectiveDraftApproval } from '../drafts/drafts.service'
import type {
  ApproveApprovedAnswerInput,
  ApprovedAnswerReviewQueueQuery,
  ArchiveApprovedAnswerInput,
  EditApprovedAnswerInput,
  ListApprovedAnswersQuery,
  ReuseApprovedAnswerInput,
  SaveApprovedAnswerInput,
  SuggestApprovedAnswersQuery,
} from './approvedAnswers.schema'

type AnswerContext = { organizationId: string; userId: string }
type SourceReference = { documentId: string; versionId: string; chunkId: string }
type LockedAnswer = {
  id: string
  currentRevisionId: string | null
  concurrencyToken: number
  archivedAt: Date | null
  reviewStatus: string
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function normalizeTags(tags: string[]) {
  const seen = new Set<string>()
  return tags.filter(tag => {
    const key = tag.toLocaleLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const relevanceStopWords = new Set([
  'a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'how', 'i', 'in', 'is', 'it', 'of', 'on',
  'our', 'the', 'to', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you', 'your',
])

function relevanceTerms(value: string) {
  return [...new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(term => term.length > 1 && !relevanceStopWords.has(term)))].slice(0, 20)
}

function sharedRelevanceTerms(
  question: string,
  answer: { title: string; question: string; tags: string[] },
) {
  const haystack = new Set(relevanceTerms([answer.title, answer.question, ...answer.tags].join(' ')))
  return relevanceTerms(question).filter(term => haystack.has(term))
}

async function lockAnswer(tx: Prisma.TransactionClient, id: string, organizationId: string) {
  const rows = await tx.$queryRaw<LockedAnswer[]>(Prisma.sql`
    SELECT "id", "currentRevisionId", "concurrencyToken", "archivedAt", "reviewStatus"
    FROM "approved_answers"
    WHERE "id" = ${id} AND "organizationId" = ${organizationId}
    FOR UPDATE
  `)
  if (!rows[0]) throw ApiError.notFound('Approved answer not found')
  return rows[0]
}

async function lockSourceDocuments(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sources: SourceReference[],
) {
  const ids = [...new Set(sources.map(source => source.documentId))].sort()
  if (!ids.length) throw ApiError.conflict('Approved answers require at least one source')
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "documents"
    WHERE "organizationId" = ${organizationId} AND "id" IN (${Prisma.join(ids)})
    ORDER BY "id" FOR SHARE
  `)
  if (locked.length !== ids.length) throw ApiError.conflict('One or more approved answer sources are unavailable')
}

async function sourcesAreCurrent(
  tx: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  revisionId: string,
) {
  const sources = await tx.approvedAnswerRevisionSource.findMany({
    where: { approvedAnswerRevisionId: revisionId, organizationId },
    select: {
      documentId: true,
      versionId: true,
      document: { select: { activeVersionId: true, deletedAt: true, status: true } },
      version: { select: { status: true } },
    },
  })
  return sources.length > 0 && sources.every(source => source.document.deletedAt === null &&
    source.document.status === 'COMPLETED' && source.document.activeVersionId === source.versionId &&
    source.version.status === 'ACTIVE')
}

async function assertCurrentSourceReferences(
  tx: Prisma.TransactionClient,
  organizationId: string,
  sources: SourceReference[],
) {
  const unique = new Map(sources.map(source => [source.chunkId, source]))
  if (unique.size !== sources.length) throw ApiError.conflict('Approved answer sources contain duplicate chunks')
  await lockSourceDocuments(tx, organizationId, sources)
  const rows = await tx.documentChunk.findMany({
    where: { id: { in: [...unique.keys()] }, document: { organizationId } },
    select: {
      id: true,
      documentId: true,
      versionId: true,
      document: { select: { activeVersionId: true, deletedAt: true, status: true } },
      version: { select: { status: true } },
    },
  })
  if (rows.length !== sources.length || rows.some(row => {
    const expected = unique.get(row.id)
    return !expected || expected.documentId !== row.documentId || expected.versionId !== row.versionId ||
      row.document.deletedAt !== null || row.document.status !== 'COMPLETED' ||
      row.document.activeVersionId !== row.versionId || row.version.status !== 'ACTIVE'
  })) throw ApiError.conflict('One or more approved answer sources are not current')
}

export async function isEffectiveApprovedAnswer(
  tx: Prisma.TransactionClient | typeof prisma,
  approvedAnswerId: string,
  revisionId: string,
  organizationId: string,
) {
  const answer = await tx.approvedAnswer.findFirst({
    where: { id: approvedAnswerId, organizationId },
    select: { currentRevisionId: true, reviewStatus: true, archivedAt: true },
  })
  if (!answer || answer.archivedAt || answer.currentRevisionId !== revisionId ||
    answer.reviewStatus !== 'APPROVED') return false
  const approval = await tx.approvedAnswerApproval.findFirst({
    where: { approvedAnswerId, revisionId, organizationId, decision: 'APPROVED' },
    select: { id: true },
  })
  return !!approval && sourcesAreCurrent(tx, organizationId, revisionId)
}

const answerSummarySelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  title: true,
  question: true,
  tags: true,
  reviewStatus: true,
  currentRevisionId: true,
  concurrencyToken: true,
  archivedAt: true,
  owner: { select: { id: true, firstName: true, lastName: true } },
  currentRevision: {
    select: { id: true, revisionNumber: true, content: true, createdAt: true },
  },
} satisfies Prisma.ApprovedAnswerSelect

async function sourceEligibilityForRevision(revisionId: string, organizationId: string) {
  const sources = await prisma.approvedAnswerRevisionSource.findMany({
    where: { approvedAnswerRevisionId: revisionId, organizationId },
    orderBy: { ordinal: 'asc' },
    select: { id: true, ordinal: true, documentId: true, versionId: true, chunkId: true },
  })
  const resolved = sources.length ? await documentsService.resolveSourceReferences({
    references: sources.map(source => ({
      documentId: source.documentId,
      versionId: source.versionId,
      chunkId: source.chunkId,
    })),
  }, organizationId) : []
  return sources.map((source, index) => ({ id: source.id, ordinal: source.ordinal, ...resolved[index] }))
}

function eligibility(reviewStatus: string, sources: Array<{ availability: string }>) {
  if (sources.some(source => source.availability === 'UNAVAILABLE')) return 'UNAVAILABLE'
  if (sources.some(source => source.availability === 'STALE')) return 'STALE'
  return reviewStatus === 'APPROVED' ? 'CURRENT' : 'REVIEW_REQUIRED'
}

async function getApprovedAnswerById(id: string, organizationId: string) {
  const answer = await prisma.approvedAnswer.findFirst({
    where: { id, organizationId },
    select: {
      ...answerSummarySelect,
      revisions: {
        orderBy: { revisionNumber: 'desc' },
        select: {
          id: true,
          createdAt: true,
          revisionNumber: true,
          title: true,
          question: true,
          content: true,
          tags: true,
          sourceDraftRevisionId: true,
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
          reviewedAt: true,
          decision: true,
          note: true,
          revisionId: true,
          sourceDraftApprovalId: true,
          reviewer: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      invalidations: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          reason: true,
          invalidatedRevisionId: true,
          replacementRevisionId: true,
          documentId: true,
          previousVersionId: true,
          currentVersionId: true,
        },
      },
    },
  })
  if (!answer) throw ApiError.notFound('Approved answer not found')
  const references = answer.revisions.flatMap(revision => revision.sources.map(source => ({
    documentId: source.documentId,
    versionId: source.versionId,
    chunkId: source.chunkId,
  })))
  const resolved = references.length
    ? await documentsService.resolveSourceReferences({ references }, organizationId)
    : []
  let sourceIndex = 0
  const revisions = answer.revisions.map(revision => ({
    ...revision,
    sources: revision.sources.map(source => ({
      id: source.id,
      ordinal: source.ordinal,
      ...resolved[sourceIndex++],
    })),
  }))
  const current = revisions.find(revision => revision.id === answer.currentRevisionId)
  return {
    ...answer,
    eligibility: current ? eligibility(answer.reviewStatus, current.sources) : 'REVIEW_REQUIRED',
    revisions,
  }
}

async function saveApprovedAnswer(input: SaveApprovedAnswerInput, context: AnswerContext) {
  const tags = normalizeTags(input.tags)
  let answerId: string
  try {
    answerId = await prisma.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "drafts"
        WHERE "id" = ${input.draftId} AND "organizationId" = ${context.organizationId}
        FOR SHARE
      `)
      const revision = await tx.draftRevision.findFirst({
        where: { id: input.revisionId, draftId: input.draftId, organizationId: context.organizationId },
        select: {
          id: true,
          content: true,
          draft: { select: { question: true } },
          sources: {
            orderBy: { ordinal: 'asc' },
            select: { documentId: true, versionId: true, chunkId: true },
          },
        },
      })
      if (!revision) throw ApiError.notFound('Draft revision not found')
      await lockSourceDocuments(tx, context.organizationId, revision.sources)
      if (!await isEffectiveDraftApproval(tx, input.draftId, input.revisionId, context.organizationId)) {
        throw ApiError.conflict('Only a current approved draft revision with current sources can be saved')
      }
      const draftApproval = await tx.draftApproval.findFirstOrThrow({
        where: {
          draftId: input.draftId,
          revisionId: input.revisionId,
          organizationId: context.organizationId,
          decision: 'APPROVED',
        },
        orderBy: { createdAt: 'desc' },
      })
      const existing = await tx.approvedAnswerRevision.findFirst({
        where: { organizationId: context.organizationId, sourceDraftRevisionId: input.revisionId },
        select: { approvedAnswerId: true, title: true, question: true, tags: true },
      })
      const question = input.question ?? revision.draft.question
      if (existing) {
        if (existing.title !== input.title || existing.question !== question ||
          JSON.stringify(existing.tags) !== JSON.stringify(tags)) {
          throw ApiError.conflict('This draft revision is already saved with different library metadata')
        }
        return existing.approvedAnswerId
      }
      const answer = await tx.approvedAnswer.create({
        data: {
          organizationId: context.organizationId,
          ownerId: context.userId,
          title: input.title,
          question,
          tags,
          currentRevisionId: null,
          reviewStatus: 'APPROVED',
        },
        select: { id: true },
      })
      const answerRevision = await tx.approvedAnswerRevision.create({
        data: {
          organizationId: context.organizationId,
          approvedAnswerId: answer.id,
          authorId: context.userId,
          revisionNumber: 1,
          title: input.title,
          question,
          content: revision.content,
          tags,
          sourceDraftRevisionId: revision.id,
        },
      })
      await tx.approvedAnswerRevisionSource.createMany({
        data: revision.sources.map((source, ordinal) => ({
          ...source,
          ordinal,
          organizationId: context.organizationId,
          approvedAnswerRevisionId: answerRevision.id,
        })),
      })
      await tx.approvedAnswerApproval.create({
        data: {
          organizationId: context.organizationId,
          approvedAnswerId: answer.id,
          revisionId: answerRevision.id,
          reviewerId: draftApproval.reviewerId,
          decision: 'APPROVED',
          note: draftApproval.note,
          reviewedAt: draftApproval.createdAt,
          sourceDraftApprovalId: draftApproval.id,
        },
      })
      await tx.approvedAnswer.update({
        where: { id: answer.id },
        data: { currentRevisionId: answerRevision.id },
      })
      return answer.id
    })
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const existing = await prisma.approvedAnswerRevision.findFirst({
      where: { organizationId: context.organizationId, sourceDraftRevisionId: input.revisionId },
      select: {
        approvedAnswerId: true,
        title: true,
        question: true,
        tags: true,
        sourceDraftRevision: { select: { draft: { select: { question: true } } } },
      },
    })
    if (!existing) throw error
    const question = input.question ?? existing.sourceDraftRevision?.draft.question
    if (existing.title !== input.title || existing.question !== question ||
      JSON.stringify(existing.tags) !== JSON.stringify(tags)) {
      throw ApiError.conflict('This draft revision is already saved with different library metadata')
    }
    answerId = existing.approvedAnswerId
  }
  return getApprovedAnswerById(answerId, context.organizationId)
}

async function listApprovedAnswers(query: ListApprovedAnswersQuery, organizationId: string) {
  const page = query.page ?? 1
  const limit = query.limit ?? 20
  const archived = query.archived ?? 'active'
  const where: Prisma.ApprovedAnswerWhereInput = {
    organizationId,
    ...(archived === 'active' ? { archivedAt: null } : archived === 'archived' ? { archivedAt: { not: null } } : {}),
    ...(query.reviewStatus && { reviewStatus: query.reviewStatus }),
    ...(query.search && { OR: [
      { title: { contains: query.search, mode: 'insensitive' } },
      { question: { contains: query.search, mode: 'insensitive' } },
      { currentRevision: { content: { contains: query.search, mode: 'insensitive' } } },
      { tags: { has: query.search } },
    ] }),
  }
  const [items, total] = await prisma.$transaction([
    prisma.approvedAnswer.findMany({
      where,
      select: answerSummarySelect,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.approvedAnswer.count({ where }),
  ])
  const decorated = await Promise.all(items.map(async item => {
    if (!item.currentRevisionId) return { ...item, eligibility: 'REVIEW_REQUIRED' }
    const sources = await sourceEligibilityForRevision(item.currentRevisionId, organizationId)
    return { ...item, eligibility: eligibility(item.reviewStatus, sources) }
  }))
  const totalPages = Math.ceil(total / limit)
  return { items: decorated, page, limit, total, totalPages,
    hasNextPage: page < totalPages, hasPrevPage: page > 1 }
}

async function editApprovedAnswer(id: string, input: EditApprovedAnswerInput, context: AnswerContext) {
  await prisma.$transaction(async tx => {
    if (input.sources) await assertCurrentSourceReferences(tx, context.organizationId, input.sources)
    const answer = await lockAnswer(tx, id, context.organizationId)
    if (answer.archivedAt) throw ApiError.conflict('Archived approved answers cannot be edited')
    if (answer.currentRevisionId !== input.expectedRevisionId) {
      throw ApiError.conflict('Approved answer changed; reload before saving')
    }
    const current = await tx.approvedAnswerRevision.findFirstOrThrow({
      where: { id: input.expectedRevisionId, approvedAnswerId: id, organizationId: context.organizationId },
      include: { sources: { orderBy: { ordinal: 'asc' } } },
    })
    const ownerId = input.ownerId ?? (await tx.approvedAnswer.findUniqueOrThrow({
      where: { id }, select: { ownerId: true },
    })).ownerId
    const owner = await tx.user.findFirst({
      where: { id: ownerId, organizationId: context.organizationId, isActive: true },
      select: { id: true },
    })
    if (!owner) throw ApiError.notFound('Approved answer owner not found')
    const next = {
      title: input.title ?? current.title,
      question: input.question ?? current.question,
      content: input.content ?? current.content,
      tags: input.tags === undefined ? current.tags : normalizeTags(input.tags),
    }
    const revision = await tx.approvedAnswerRevision.create({
      data: {
        organizationId: context.organizationId,
        approvedAnswerId: id,
        authorId: context.userId,
        revisionNumber: answer.concurrencyToken + 1,
        ...next,
      },
    })
    const nextSources = input.sources ?? current.sources.map(source => ({
      documentId: source.documentId,
      versionId: source.versionId,
      chunkId: source.chunkId,
    }))
    await tx.approvedAnswerRevisionSource.createMany({
      data: nextSources.map((source, ordinal) => ({
        organizationId: context.organizationId,
        approvedAnswerRevisionId: revision.id,
        ordinal,
        documentId: source.documentId,
        versionId: source.versionId,
        chunkId: source.chunkId,
      })),
    })
    await tx.approvedAnswerInvalidation.create({ data: {
      organizationId: context.organizationId,
      approvedAnswerId: id,
      invalidatedRevisionId: current.id,
      replacementRevisionId: revision.id,
      reason: 'ANSWER_EDITED',
    } })
    const updated = await tx.approvedAnswer.updateMany({
      where: {
        id,
        organizationId: context.organizationId,
        currentRevisionId: answer.currentRevisionId,
        concurrencyToken: answer.concurrencyToken,
        archivedAt: null,
      },
      data: {
        title: next.title,
        question: next.question,
        tags: next.tags,
        ownerId,
        currentRevisionId: revision.id,
        concurrencyToken: { increment: 1 },
        reviewStatus: 'REQUIRED',
      },
    })
    if (updated.count !== 1) throw ApiError.conflict('Approved answer changed; reload before saving')
  })
  return getApprovedAnswerById(id, context.organizationId)
}

async function approveApprovedAnswer(
  id: string,
  input: ApproveApprovedAnswerInput,
  context: AnswerContext,
) {
  await prisma.$transaction(async tx => {
    const revision = await tx.approvedAnswerRevision.findFirst({
      where: { id: input.revisionId, approvedAnswerId: id, organizationId: context.organizationId },
      include: { sources: { orderBy: { ordinal: 'asc' } } },
    })
    if (!revision) {
      await lockAnswer(tx, id, context.organizationId)
      throw ApiError.conflict('Only the current approved answer revision can be reviewed')
    }
    if (revision.authorId === context.userId) throw ApiError.forbidden('A revision author cannot approve their own change')
    await lockSourceDocuments(tx, context.organizationId, revision.sources)
    const answer = await lockAnswer(tx, id, context.organizationId)
    if (answer.archivedAt) throw ApiError.conflict('Archived approved answers cannot be reviewed')
    if (answer.currentRevisionId !== input.revisionId) {
      throw ApiError.conflict('Only the current approved answer revision can be reviewed')
    }
    if (!await sourcesAreCurrent(tx, context.organizationId, revision.id)) {
      throw ApiError.conflict('Approved answer sources changed; update the answer before review')
    }
    if (await isEffectiveApprovedAnswer(tx, id, revision.id, context.organizationId)) {
      throw ApiError.conflict('Approved answer revision is already current and approved')
    }
    const now = new Date()
    await tx.approvedAnswerApproval.create({ data: {
      organizationId: context.organizationId,
      approvedAnswerId: id,
      revisionId: revision.id,
      reviewerId: context.userId,
      decision: 'APPROVED',
      note: input.note,
      reviewedAt: now,
    } })
    const updated = await tx.approvedAnswer.updateMany({
      where: { id, organizationId: context.organizationId, currentRevisionId: revision.id, archivedAt: null },
      data: { reviewStatus: 'APPROVED' },
    })
    if (updated.count !== 1) throw ApiError.conflict('Approved answer changed during review')
  })
  return getApprovedAnswerById(id, context.organizationId)
}

async function archiveApprovedAnswer(
  id: string,
  input: ArchiveApprovedAnswerInput,
  organizationId: string,
) {
  const updated = await prisma.approvedAnswer.updateMany({
    where: { id, organizationId, concurrencyToken: input.expectedConcurrencyToken, archivedAt: null },
    data: { archivedAt: new Date(), concurrencyToken: { increment: 1 } },
  })
  if (updated.count !== 1) {
    const answer = await prisma.approvedAnswer.findFirst({ where: { id, organizationId }, select: { id: true } })
    if (!answer) throw ApiError.notFound('Approved answer not found')
    throw ApiError.conflict('Approved answer changed or is already archived; reload before archiving')
  }
  return getApprovedAnswerById(id, organizationId)
}

async function suggestApprovedAnswers(query: SuggestApprovedAnswersQuery, organizationId: string) {
  const terms = relevanceTerms(query.question)
  if (!terms.length) return []
  const candidates = await prisma.approvedAnswer.findMany({
    where: {
      organizationId,
      archivedAt: null,
      reviewStatus: 'APPROVED',
      OR: terms.flatMap(term => [
        { title: { contains: term, mode: 'insensitive' as const } },
        { question: { contains: term, mode: 'insensitive' as const } },
        { tags: { has: term } },
      ]),
    },
    select: {
      ...answerSummarySelect,
      currentRevision: {
        select: { id: true, revisionNumber: true, content: true, createdAt: true,
          sources: { select: { id: true } } },
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 100,
  })
  const eligible = []
  for (const candidate of candidates) {
    if (!candidate.currentRevisionId || !candidate.currentRevision) continue
    const sharedTerms = sharedRelevanceTerms(query.question, candidate)
    if (!sharedTerms.length || !await isEffectiveApprovedAnswer(
      prisma, candidate.id, candidate.currentRevisionId, organizationId,
    )) continue
    eligible.push({
      id: candidate.id,
      title: candidate.title,
      question: candidate.question,
      tags: candidate.tags,
      owner: candidate.owner,
      currentRevision: {
        id: candidate.currentRevision.id,
        revisionNumber: candidate.currentRevision.revisionNumber,
        content: candidate.currentRevision.content,
        createdAt: candidate.currentRevision.createdAt,
        sourceCount: candidate.currentRevision.sources.length,
      },
      suggestionReason: `Shared terms: ${sharedTerms.join(', ')}`,
      sharedTerms,
      updatedAt: candidate.updatedAt,
    })
  }
  eligible.sort((left, right) => right.sharedTerms.length - left.sharedTerms.length ||
    right.updatedAt.getTime() - left.updatedAt.getTime())
  return eligible.slice(0, query.limit ?? 5).map(({ sharedTerms: _sharedTerms, ...item }) => item)
}

type QueueReason = {
  code: 'ANSWER_EDITED' | 'SOURCE_DELETED' | 'SOURCE_UPDATED' | 'SOURCE_UNAVAILABLE'
  documentId?: string
  referencedVersionId?: string
  currentVersionId?: string | null
}

function queueReasons(answer: {
  reviewStatus: string
  currentRevision: null | { sources: Array<{
    documentId: string
    versionId: string
    document: { activeVersionId: string | null; deletedAt: Date | null; status: string }
    version: { status: string }
  }> }
}) {
  if (!answer.currentRevision) return [{ code: 'ANSWER_EDITED' as const }]
  const reasons = answer.currentRevision.sources.flatMap<QueueReason>(source => {
    if (source.document.deletedAt || source.document.status === 'DELETED') return [{
      code: 'SOURCE_DELETED' as const,
      documentId: source.documentId,
      referencedVersionId: source.versionId,
      currentVersionId: null,
    }]
    if (source.document.activeVersionId !== source.versionId) return [{
      code: 'SOURCE_UPDATED' as const,
      documentId: source.documentId,
      referencedVersionId: source.versionId,
      currentVersionId: source.document.activeVersionId,
    }]
    if (source.document.status !== 'COMPLETED' || source.version.status !== 'ACTIVE') return [{
      code: 'SOURCE_UNAVAILABLE' as const,
      documentId: source.documentId,
      referencedVersionId: source.versionId,
      currentVersionId: source.document.activeVersionId,
    }]
    return []
  })
  if (!reasons.length && answer.reviewStatus !== 'APPROVED') reasons.push({ code: 'ANSWER_EDITED' as const })
  return reasons
}

async function listApprovedAnswerReviewQueue(
  query: ApprovedAnswerReviewQueueQuery,
  organizationId: string,
) {
  const page = query.page ?? 1
  const limit = query.limit ?? 20
  const offset = (page - 1) * limit
  const predicate = Prisma.sql`
    a."organizationId" = ${organizationId}
    AND a."archivedAt" IS NULL
    AND (
      a."reviewStatus" <> 'APPROVED'
      OR a."currentRevisionId" IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM "approved_answer_approvals" ap
        WHERE ap."approvedAnswerId" = a."id"
          AND ap."revisionId" = a."currentRevisionId"
          AND ap."organizationId" = a."organizationId"
          AND ap."decision" = 'APPROVED'
      )
      OR EXISTS (
        SELECT 1 FROM "approved_answer_revision_sources" s
        JOIN "documents" d ON d."id" = s."documentId" AND d."organizationId" = s."organizationId"
        JOIN "document_versions" v ON v."id" = s."versionId"
          AND v."documentId" = s."documentId" AND v."organizationId" = s."organizationId"
        WHERE s."approvedAnswerRevisionId" = a."currentRevisionId"
          AND s."organizationId" = a."organizationId"
          AND (d."deletedAt" IS NOT NULL OR d."status" <> 'COMPLETED'
            OR d."activeVersionId" IS DISTINCT FROM s."versionId" OR v."status" <> 'ACTIVE')
      )
    )
  `
  const [ids, counts] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT a."id" FROM "approved_answers" a
      WHERE ${predicate}
      ORDER BY a."updatedAt" DESC, a."id" DESC
      LIMIT ${limit} OFFSET ${offset}
    `),
    prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*) AS count FROM "approved_answers" a WHERE ${predicate}
    `),
  ])
  const order = new Map(ids.map((row, index) => [row.id, index]))
  const answers = ids.length ? await prisma.approvedAnswer.findMany({
    where: { id: { in: ids.map(row => row.id) }, organizationId },
    select: {
      ...answerSummarySelect,
      currentRevision: {
        select: {
          id: true,
          revisionNumber: true,
          content: true,
          createdAt: true,
          sources: {
            orderBy: { ordinal: 'asc' },
            select: {
              documentId: true,
              versionId: true,
              document: { select: { activeVersionId: true, deletedAt: true, status: true } },
              version: { select: { status: true } },
            },
          },
        },
      },
      invalidations: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          createdAt: true,
          reason: true,
          invalidatedRevisionId: true,
          replacementRevisionId: true,
          documentId: true,
          previousVersionId: true,
          currentVersionId: true,
        },
      },
    },
  }) : []
  answers.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0))
  const total = Number(counts[0]?.count ?? 0n)
  const totalPages = Math.ceil(total / limit)
  return {
    items: answers.map(answer => ({ ...answer, reasons: queueReasons(answer) })),
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }
}

async function reuseApprovedAnswer(id: string, input: ReuseApprovedAnswerInput, context: AnswerContext) {
  const fingerprint = sha256Hex(JSON.stringify({
    approvedAnswerId: id,
    revisionId: input.expectedRevisionId,
    question: input.question,
    title: input.title ?? null,
  }))
  let draftId: string
  try {
    draftId = await prisma.$transaction(async tx => {
      const revision = await tx.approvedAnswerRevision.findFirst({
        where: { id: input.expectedRevisionId, approvedAnswerId: id, organizationId: context.organizationId },
        include: { sources: { orderBy: { ordinal: 'asc' } } },
      })
      if (!revision) {
        await lockAnswer(tx, id, context.organizationId)
        throw ApiError.conflict('Approved answer changed; reload the current suggestion')
      }
      const sharedTerms = sharedRelevanceTerms(input.question, revision)
      if (!sharedTerms.length) {
        throw ApiError.conflict('Approved answer is not relevant to the new question')
      }
      await lockSourceDocuments(tx, context.organizationId, revision.sources)
      const answer = await lockAnswer(tx, id, context.organizationId)
      if (answer.archivedAt) throw ApiError.conflict('Archived approved answers cannot be reused')
      if (answer.currentRevisionId !== input.expectedRevisionId) {
        throw ApiError.conflict('Approved answer changed; reload the current suggestion')
      }
      if (!await isEffectiveApprovedAnswer(tx, id, revision.id, context.organizationId)) {
        throw ApiError.conflict('Approved answer is no longer current and reusable')
      }
      const existing = await tx.draft.findUnique({
        where: { organizationId_idempotencyKey: {
          organizationId: context.organizationId,
          idempotencyKey: input.idempotencyKey,
        } },
        select: { id: true, requestFingerprint: true },
      })
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) {
          throw ApiError.conflict('Idempotency key was already used with different reuse input')
        }
        return existing.id
      }
      const draft = await tx.draft.create({ data: {
        organizationId: context.organizationId,
        authorId: context.userId,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
        title: input.title ?? revision.title,
        question: input.question,
        requestedDocumentIds: [...new Set(revision.sources.map(source => source.documentId))],
        reusedApprovedAnswerId: id,
        reusedApprovedAnswerRevisionId: revision.id,
      } })
      const draftRevision = await tx.draftRevision.create({ data: {
        organizationId: context.organizationId,
        draftId: draft.id,
        authorId: context.userId,
        revisionNumber: 1,
        content: revision.content,
        origin: 'MANUAL',
      } })
      await tx.draftRevisionSource.createMany({ data: revision.sources.map(source => ({
        organizationId: context.organizationId,
        draftRevisionId: draftRevision.id,
        ordinal: source.ordinal,
        documentId: source.documentId,
        versionId: source.versionId,
        chunkId: source.chunkId,
      })) })
      await tx.draft.update({ where: { id: draft.id }, data: {
        currentRevisionId: draftRevision.id,
        concurrencyToken: 1,
        processingStatus: 'COMPLETED',
        reviewStatus: 'REQUIRED',
      } })
      return draft.id
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
      throw ApiError.conflict('Idempotency key was already used with different reuse input')
    }
    draftId = existing.id
  }
  return draftsService.getDraftById(draftId, context.organizationId)
}

export const approvedAnswersService = {
  saveApprovedAnswer,
  listApprovedAnswers,
  getApprovedAnswerById,
  editApprovedAnswer,
  approveApprovedAnswer,
  archiveApprovedAnswer,
  suggestApprovedAnswers,
  listApprovedAnswerReviewQueue,
  reuseApprovedAnswer,
}
