import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { groundedAnswersService } from '../groundedAnswers/groundedAnswers.service'
import { WorkloadAdmissionError } from '../usage/workloadReservations.service'
import { parseQuestionnaireImport, type QuestionnaireImport } from './questionnaireImport'
import { draftsService, isEffectiveDraftApproval } from '../drafts/drafts.service'
import { questionnaireCsv } from './questionnaireCsv'

const leaseMs = 60_000
const maxRowAttempts = 2
type Answer = Awaited<ReturnType<typeof groundedAnswersService.answerQuestion>>
type Claim = { id: string; organizationId: string; leaseOwner: string; leaseVersion: number; documentIds: string[] }
const rowInclude = { draft: { select: { id: true, currentRevisionId: true, reviewStatus: true,
  currentRevision: { select: { revisionNumber: true, content: true } } } } } as const

async function getJob(id: string, organizationId: string) {
  const job = await prisma.questionnaireJob.findFirst({
    where: { id, organizationId },
    include: { rows: { orderBy: { rowIndex: 'asc' }, include: rowInclude } },
  })
  if (!job) throw ApiError.notFound('Questionnaire job not found')
  return job
}

async function listJobs(organizationId: string) {
  return prisma.questionnaireJob.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' },
    take: 50, select: { id: true, createdAt: true, format: true, status: true,
      _count: { select: { rows: true } } } })
}

async function exportJob(id: string, organizationId: string, includeSources: boolean) {
  const job = await getJob(id, organizationId)
  const rows = await Promise.all(job.rows.map(async row => {
    const draft = row.draftId ? await draftsService.getDraftById(row.draftId, organizationId) : null
    const revision = draft?.revisions?.find(item => item.id === draft.currentRevisionId)
    const sources = revision?.sources ?? []
    const sourceStatus = !sources.length ? 'NO_SOURCES' : sources.some(item => item.availability === 'UNAVAILABLE')
      ? 'UNAVAILABLE' : sources.some(item => item.availability === 'STALE') ? 'STALE' : 'CURRENT'
    const reviewStatus = draft?.archivedAt ? 'ARCHIVED' : draft?.id && revision?.id &&
      await isEffectiveDraftApproval(prisma, draft.id, revision.id, organizationId) ? 'APPROVED' : 'REQUIRED'
    return [row.rowIndex, row.rowId, row.question, row.status, revision?.content ?? row.answer ?? '',
      draft?.id ?? '', revision?.id ?? '', reviewStatus, sourceStatus,
      includeSources && sourceStatus === 'CURRENT' ? sources.map(item => `${item.documentId}/${item.versionId}/${item.chunkId}`).join('; ') : '',
      row.errorCode ?? '']
  }))
  return questionnaireCsv(rows)
}

async function createJob(input: QuestionnaireImport, organizationId: string) {
  const imported = parseQuestionnaireImport(input)
  const ids = [...new Set(imported.documentIds)]
  if (ids.length !== imported.documentIds.length || (ids.length && await prisma.document.count({
    where: { id: { in: ids }, organizationId, deletedAt: null },
  }) !== ids.length)) throw ApiError.notFound('Document not found')
  return prisma.questionnaireJob.create({
    data: {
      organizationId, format: imported.format, documentIds: ids,
      rows: { create: imported.rows.map((row, rowIndex) => ({ ...row, rowIndex })) },
    },
    include: { rows: { orderBy: { rowIndex: 'asc' }, include: rowInclude } },
  })
}

async function cancelJob(id: string, organizationId: string) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "questionnaire_jobs" WHERE "id" = ${id} FOR UPDATE`
    const job = await tx.questionnaireJob.findFirst({ where: { id, organizationId } })
    if (!job) throw ApiError.notFound('Questionnaire job not found')
    if (job.status === 'CANCELLED') return
    if (job.status === 'COMPLETED') throw ApiError.conflict('Completed questionnaire cannot be cancelled')
    await tx.questionnaireJob.update({ where: { id }, data: {
      status: 'CANCELLED', leaseOwner: null, leaseExpiresAt: null, leaseVersion: { increment: 1 },
    } })
    await tx.questionnaireRow.updateMany({ where: { jobId: id, status: { in: ['QUEUED', 'PROCESSING'] } }, data: {
      status: 'CANCELLED', errorCode: null,
    } })
  })
  return getJob(id, organizationId)
}

async function retryRow(id: string, rowIndex: number, organizationId: string) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "questionnaire_jobs" WHERE "id" = ${id} FOR UPDATE`
    const job = await tx.questionnaireJob.findFirst({ where: { id, organizationId } })
    if (!job) throw ApiError.notFound('Questionnaire job not found')
    if (job.status === 'RUNNING' || job.status === 'CANCELLED') throw ApiError.conflict('Questionnaire cannot retry from its current state')
    const row = await tx.questionnaireRow.findUnique({ where: { jobId_rowIndex: { jobId: id, rowIndex } } })
    if (!row) throw ApiError.notFound('Questionnaire row not found')
    if (row.status !== 'ERROR' || row.attemptCount >= maxRowAttempts) throw ApiError.conflict('Questionnaire row cannot be retried')
    await tx.questionnaireRow.update({ where: { id: row.id }, data: { status: 'QUEUED', errorCode: null } })
    await tx.questionnaireJob.update({ where: { id }, data: { status: 'QUEUED' } })
  })
  return getJob(id, organizationId)
}

async function claimJob(): Promise<Claim | null> {
  return prisma.$transaction(async tx => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "questionnaire_jobs"
      WHERE "status" = 'QUEUED' OR ("status" = 'RUNNING' AND "leaseExpiresAt" <= NOW())
      ORDER BY "updatedAt", "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`
    const candidate = candidates[0]
    if (!candidate) return null
    const job = await tx.questionnaireJob.update({ where: { id: candidate.id }, data: {
      status: 'RUNNING', leaseOwner: randomUUID(), leaseVersion: { increment: 1 },
      leaseExpiresAt: new Date(Date.now() + leaseMs),
    } })
    await tx.questionnaireRow.updateMany({ where: { jobId: job.id, status: 'PROCESSING', attemptCount: { lt: maxRowAttempts } }, data: { status: 'QUEUED' } })
    await tx.questionnaireRow.updateMany({ where: { jobId: job.id, status: 'PROCESSING', attemptCount: { gte: maxRowAttempts } }, data: {
      status: 'ERROR', errorCode: 'INTERRUPTED',
    } })
    return { id: job.id, organizationId: job.organizationId, leaseOwner: job.leaseOwner!,
      leaseVersion: job.leaseVersion, documentIds: job.documentIds }
  })
}

async function withClaim<T>(claim: Claim, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T | null> {
  return prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "questionnaire_jobs" WHERE "id" = ${claim.id} FOR UPDATE`
    if (!locked.length) return null
    const job = await tx.questionnaireJob.findFirst({ where: {
      id: claim.id, organizationId: claim.organizationId, status: 'RUNNING',
      leaseOwner: claim.leaseOwner, leaseVersion: claim.leaseVersion, leaseExpiresAt: { gt: new Date() },
    } })
    return job ? work(tx) : null
  })
}

async function processNext(params: {
  signal?: AbortSignal
  answerQuestion?: (question: string, documentIds: string[] | undefined, requestId: string) => Promise<Answer>
} = {}) {
  if (params.signal?.aborted) return null
  const claim = await claimJob()
  if (!claim) return null
  const abort = new AbortController()
  const onAbort = () => abort.abort(params.signal?.reason)
  params.signal?.addEventListener('abort', onAbort, { once: true })
  if (params.signal?.aborted) onAbort()
  const heartbeat = setInterval(async () => {
    try {
      const updated = await prisma.questionnaireJob.updateMany({ where: {
        id: claim.id, status: 'RUNNING', leaseOwner: claim.leaseOwner,
        leaseVersion: claim.leaseVersion, leaseExpiresAt: { gt: new Date() },
      }, data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } })
      if (updated.count !== 1) abort.abort(new Error('Questionnaire lease lost'))
    } catch { abort.abort(new Error('Questionnaire heartbeat failed')) }
  }, leaseMs / 3)
  heartbeat.unref()
  try {
    while (!abort.signal.aborted) {
      const row = await withClaim(claim, async tx => {
        const next = await tx.questionnaireRow.findFirst({ where: { jobId: claim.id, status: 'QUEUED' }, orderBy: { rowIndex: 'asc' } })
        if (!next) {
          await tx.questionnaireJob.update({ where: { id: claim.id }, data: {
            status: 'COMPLETED', leaseOwner: null, leaseExpiresAt: null,
          } })
          return null
        }
        return tx.questionnaireRow.update({ where: { id: next.id }, data: {
          status: 'PROCESSING', attemptCount: { increment: 1 },
        } })
      })
      if (!row) break
      let result: { status: 'SUCCESS' | 'REFUSAL' | 'ERROR'; answer: string | null; confidence: Answer['confidence'] | null; citations: Prisma.InputJsonValue; errorCode: string | null }
      let grounded: Answer | null = null
      try {
        const answer = await (params.answerQuestion ?? ((question, documentIds, requestId) => groundedAnswersService.answerQuestion(
          { question, documentIds }, { organizationId: claim.organizationId, signal: abort.signal, requestId }
        )))(row.question, claim.documentIds.length ? claim.documentIds : undefined, `questionnaire:${claim.id}:${row.rowIndex}:${row.attemptCount}`)
        if (typeof answer?.answer !== 'string' || !answer.answer.trim() || typeof answer.refused !== 'boolean' ||
          !['LOW', 'MEDIUM', 'HIGH'].includes(answer.confidence) || !Array.isArray(answer.citations) ||
          !answer.citations.every(citation => citation && typeof citation.documentId === 'string' &&
            typeof citation.versionId === 'string' && typeof citation.chunkId === 'string')) throw new Error('Malformed answer')
        result = { status: answer.refused ? 'REFUSAL' : 'SUCCESS', answer: answer.answer,
          confidence: answer.confidence, citations: answer.citations as Prisma.InputJsonValue, errorCode: null }
        grounded = answer
      } catch (error) {
        if (abort.signal.aborted) break
        if (error instanceof WorkloadAdmissionError) {
          await withClaim(claim, async tx => {
            await tx.questionnaireRow.update({ where: { id: row.id }, data: { status: 'QUEUED', attemptCount: { decrement: 1 } } })
            await tx.questionnaireJob.update({ where: { id: claim.id }, data: { status: 'QUEUED', leaseOwner: null, leaseExpiresAt: null } })
          })
          break
        }
        result = { status: 'ERROR', answer: null, confidence: null, citations: [], errorCode: 'ANSWER_FAILED' }
      }
      const saved = await withClaim(claim, async tx => {
        if (grounded) {
          const sources = [...new Map(grounded.citations.map(citation => [citation.chunkId, citation])).values()]
          if (sources.length) {
            const chunks = await tx.documentChunk.findMany({ where: { id: { in: sources.map(source => source.chunkId) },
              document: { organizationId: claim.organizationId } }, select: { id: true, documentId: true, versionId: true } })
            if (chunks.length !== sources.length || chunks.some(chunk => {
              const source = sources.find(item => item.chunkId === chunk.id)
              return !source || source.documentId !== chunk.documentId || source.versionId !== chunk.versionId
            })) return tx.questionnaireRow.update({ where: { id: row.id }, data: {
              status: 'ERROR', answer: null, confidence: null, citations: [], errorCode: 'SOURCE_UNAVAILABLE',
            } })
          }
          const draft = await tx.draft.create({ data: { organizationId: claim.organizationId,
            authorId: null, idempotencyKey: `questionnaire:${claim.id}:${row.rowIndex}`,
            requestFingerprint: `questionnaire:${row.id}`, question: row.question,
            requestedDocumentIds: claim.documentIds } })
          const revision = await tx.draftRevision.create({ data: { draftId: draft.id,
            organizationId: claim.organizationId, authorId: null, revisionNumber: 1,
            content: grounded.answer, origin: 'GENERATED', isRefusal: grounded.refused,
            aiInteractionId: grounded.aiInteractionId } })
          if (sources.length) await tx.draftRevisionSource.createMany({ data: sources.map((citation, ordinal) => ({
            draftRevisionId: revision.id, organizationId: claim.organizationId, ordinal,
            documentId: citation.documentId, versionId: citation.versionId, chunkId: citation.chunkId,
          })) })
          await tx.draft.update({ where: { id: draft.id }, data: { currentRevisionId: revision.id,
            concurrencyToken: 1, processingStatus: grounded.refused ? 'REFUSED' : 'COMPLETED' } })
          return tx.questionnaireRow.update({ where: { id: row.id }, data: { ...result, draftId: draft.id } })
        }
        return tx.questionnaireRow.update({ where: { id: row.id }, data: result })
      })
      if (!saved) break
    }
  } finally {
    clearInterval(heartbeat)
    params.signal?.removeEventListener('abort', onAbort)
  }
  return getJob(claim.id, claim.organizationId)
}

export const questionnairesService = { createJob, getJob, listJobs, exportJob, cancelJob, retryRow, processNext }
