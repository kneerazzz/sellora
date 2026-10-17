import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { sha256Hex } from '../../utils/crypto'
import type { WorkflowClaim } from '../workflowRuns/workflowLease'
import type { GmailReceivedInput } from '../webhooks/webhooks.schema'

export type GmailReviewAnswer = { question: string; answer?: string | null; refused?: boolean; error?: string;
  citations?: Array<{ documentId: string; versionId: string; chunkId: string }> }

/** One system-authored draft per event. The run row lock fences expired workers before the write. */
export async function createGmailReviewTask(input: {
  claim: WorkflowClaim
  eventId: string
  message: GmailReceivedInput
  answers: GmailReviewAnswer[]
  issue?: string
}) {
  return prisma.$transaction(async tx => {
    const owned = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "workflow_runs" WHERE "id" = ${input.claim.id}
        AND "organizationId" = ${input.claim.organizationId} AND "status" = 'RUNNING'
        AND "leaseOwner" = ${input.claim.leaseOwner} AND "leaseVersion" = ${input.claim.leaseVersion}
        AND "leaseExpiresAt" > NOW() FOR UPDATE
    `)
    if (!owned.length) return null
    const idempotencyKey = `gmail:${input.eventId}`
    const existing = await tx.draft.findUnique({ where: { organizationId_idempotencyKey: {
      organizationId: input.claim.organizationId, idempotencyKey,
    } }, select: { id: true } })
    if (existing) return existing.id

    const references = [...new Map(input.answers.flatMap(answer => (answer.citations ?? [])
      .map(({ documentId, versionId, chunkId }) => ({ documentId, versionId, chunkId })))
      .map(source => [source.chunkId, source])).values()].slice(0, 30)
    const chunks = references.length ? await tx.documentChunk.findMany({
      where: { id: { in: references.map(source => source.chunkId) }, document: { organizationId: input.claim.organizationId } },
      select: { id: true, documentId: true, versionId: true,
        document: { select: { status: true, deletedAt: true, activeVersionId: true } },
        version: { select: { status: true } } },
    }) : []
    const validSources = chunks.length === references.length && chunks.every(chunk => {
      const source = references.find(item => item.chunkId === chunk.id)
      return source?.documentId === chunk.documentId && source.versionId === chunk.versionId &&
        chunk.document.status === 'COMPLETED' && !chunk.document.deletedAt &&
        chunk.document.activeVersionId === chunk.versionId && chunk.version.status === 'ACTIVE'
    })
    const contentLimit = Math.min(env.PROVIDER_INPUT_MAX_CHARS, 16_000)
    const rawContent = input.answers.length ? input.answers.map((answer, index) =>
      `${index + 1}. ${answer.question.slice(0, 1000)}\n${answer.answer?.trim().slice(0, 4000) || 'Answer needs manual review.'}`
    ).join('\n\n')
      : 'No buyer question could be prepared. Review the original email and write a reply manually.'
    const issue = input.issue ?? (!validSources ? 'Linked source unavailable; check the answer manually' :
      rawContent.length > contentLimit ? 'Answer preview truncated; check the original workflow result' : undefined)
    const content = rawContent.slice(0, contentLimit - (issue?.length ?? 0) - (issue ? 2 : 0))
    const needsManualReview = !!issue || !input.answers.length || input.answers.some(answer => answer.refused || answer.error || !answer.answer)
    const original = `From: ${input.message.from}\nSubject: ${input.message.subject}\n\n${input.message.text}`
    const questionLimit = Math.min(env.PROVIDER_INPUT_MAX_CHARS, 16_000)
    const note = '\n[Email text truncated; inspect Activity for the complete intake]'
    const question = original.length > questionLimit
      ? original.slice(0, questionLimit - note.length) + note : original
    const draft = await tx.draft.create({ data: {
      organizationId: input.claim.organizationId, authorId: null,
      idempotencyKey, requestFingerprint: sha256Hex(JSON.stringify(input.message)),
      title: `Email: ${input.message.subject}`.slice(0, 255), question,
      requestedDocumentIds: [],
      reviewStatus: 'REQUIRED', deliveryStatus: 'NOT_REQUESTED',
    }, select: { id: true } })
    const revision = await tx.draftRevision.create({ data: {
      organizationId: input.claim.organizationId, draftId: draft.id, authorId: null,
      revisionNumber: 1, origin: 'GENERATED', isRefusal: needsManualReview,
      content: issue ? `${issue}\n\n${content}` : content,
    }, select: { id: true } })
    if (validSources && references.length) await tx.draftRevisionSource.createMany({ data: references.map((source, ordinal) => ({
      organizationId: input.claim.organizationId, draftRevisionId: revision.id, ordinal, ...source,
    })) })
    await tx.draft.update({ where: { id: draft.id }, data: { currentRevisionId: revision.id, concurrencyToken: 1,
      processingStatus: needsManualReview ? 'REFUSED' : 'COMPLETED' } })
    return draft.id
  })
}
