import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { groundedAnswersService } from '../groundedAnswers/groundedAnswers.service'
import { WorkloadAdmissionError } from '../usage/workloadReservations.service'
import { parseQuestionnaireImport, type QuestionnaireImport } from './questionnaireImport'

const leaseMs = 60_000
const maxRowAttempts = 2
type Answer = Awaited<ReturnType<typeof groundedAnswersService.answerQuestion>>
type Claim = { id: string; organizationId: string; leaseOwner: string; leaseVersion: number; documentIds: string[] }

async function getJob(id: string, organizationId: string) {
  const job = await prisma.questionnaireJob.findFirst({
    where: { id, organizationId },
    include: { rows: { orderBy: { rowIndex: 'asc' } } },
  })
  if (!job) throw ApiError.notFound('Questionnaire job not found')
  return job
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
    include: { rows: { orderBy: { rowIndex: 'asc' } } },
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
      ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`
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
      try {
        const answer = await (params.answerQuestion ?? ((question, documentIds, requestId) => groundedAnswersService.answerQuestion(
          { question, documentIds }, { organizationId: claim.organizationId, signal: abort.signal, requestId }
        )))(row.question, claim.documentIds.length ? claim.documentIds : undefined, `questionnaire:${claim.id}:${row.rowIndex}:${row.attemptCount}`)
        if (typeof answer?.answer !== 'string' || !answer.answer.trim() || typeof answer.refused !== 'boolean' ||
          !['LOW', 'MEDIUM', 'HIGH'].includes(answer.confidence) || !Array.isArray(answer.citations)) throw new Error('Malformed answer')
        result = { status: answer.refused ? 'REFUSAL' : 'SUCCESS', answer: answer.answer,
          confidence: answer.confidence, citations: answer.citations as Prisma.InputJsonValue, errorCode: null }
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
      const saved = await withClaim(claim, tx => tx.questionnaireRow.update({ where: { id: row.id }, data: result }))
      if (!saved) break
    }
  } finally {
    clearInterval(heartbeat)
    params.signal?.removeEventListener('abort', onAbort)
  }
  return getJob(claim.id, claim.organizationId)
}

export const questionnairesService = { createJob, getJob, cancelJob, retryRow, processNext }
