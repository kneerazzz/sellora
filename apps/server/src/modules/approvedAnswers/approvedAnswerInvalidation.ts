import { Prisma } from '@prisma/client'

type SourceInvalidation = {
  organizationId: string
  documentId: string
  previousVersionId: string | null
  currentVersionId: string | null
  reason: 'SOURCE_REPLACED' | 'SOURCE_DELETED'
}

/** Runs inside the document publication/deletion transaction. */
export async function invalidateApprovedAnswersForDocument(
  tx: Prisma.TransactionClient,
  input: SourceInvalidation,
) {
  if (!input.previousVersionId) return 0
  const affected = await tx.$queryRaw<Array<{ id: string; currentRevisionId: string }>>(Prisma.sql`
    SELECT a."id", a."currentRevisionId"
    FROM "approved_answers" a
    WHERE a."organizationId" = ${input.organizationId}
      AND a."archivedAt" IS NULL
      AND a."currentRevisionId" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "approved_answer_revision_sources" s
        WHERE s."approvedAnswerRevisionId" = a."currentRevisionId"
          AND s."organizationId" = a."organizationId"
          AND s."documentId" = ${input.documentId}
          AND s."versionId" = ${input.previousVersionId}
      )
    ORDER BY a."id"
    FOR UPDATE
  `)
  if (!affected.length) return 0
  await tx.approvedAnswerInvalidation.createMany({
    data: affected.map(answer => ({
      organizationId: input.organizationId,
      approvedAnswerId: answer.id,
      invalidatedRevisionId: answer.currentRevisionId,
      documentId: input.documentId,
      previousVersionId: input.previousVersionId!,
      currentVersionId: input.currentVersionId,
      reason: input.reason,
    })),
  })
  await tx.approvedAnswer.updateMany({
    where: { id: { in: affected.map(answer => answer.id) }, organizationId: input.organizationId },
    data: { reviewStatus: 'REQUIRED' },
  })
  return affected.length
}
