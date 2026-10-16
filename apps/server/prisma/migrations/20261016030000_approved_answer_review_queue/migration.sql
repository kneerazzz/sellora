CREATE TYPE "ApprovedAnswerInvalidationReason" AS ENUM (
  'ANSWER_EDITED', 'SOURCE_REPLACED', 'SOURCE_DELETED'
);

CREATE TABLE "approved_answer_invalidations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" "ApprovedAnswerInvalidationReason" NOT NULL,
  "organizationId" TEXT NOT NULL,
  "approvedAnswerId" TEXT NOT NULL,
  "invalidatedRevisionId" TEXT NOT NULL,
  "replacementRevisionId" TEXT,
  "documentId" TEXT,
  "previousVersionId" TEXT,
  "currentVersionId" TEXT,
  CONSTRAINT "approved_answer_invalidations_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_invalidations_answerId_organizationId_fkey"
    FOREIGN KEY ("approvedAnswerId", "organizationId")
    REFERENCES "approved_answers"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_invalidations_invalidatedRevision_lineage_fkey"
    FOREIGN KEY ("invalidatedRevisionId", "approvedAnswerId", "organizationId")
    REFERENCES "approved_answer_revisions"("id", "approvedAnswerId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_invalidations_replacementRevision_lineage_fkey"
    FOREIGN KEY ("replacementRevisionId", "approvedAnswerId", "organizationId")
    REFERENCES "approved_answer_revisions"("id", "approvedAnswerId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_invalidations_document_organization_fkey"
    FOREIGN KEY ("documentId", "organizationId")
    REFERENCES "documents"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_invalidations_previousVersion_lineage_fkey"
    FOREIGN KEY ("previousVersionId", "documentId", "organizationId")
    REFERENCES "document_versions"("id", "documentId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_invalidations_currentVersion_lineage_fkey"
    FOREIGN KEY ("currentVersionId", "documentId", "organizationId")
    REFERENCES "document_versions"("id", "documentId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_invalidations_shape_check" CHECK (
    ("reason" = 'ANSWER_EDITED' AND "replacementRevisionId" IS NOT NULL
      AND "documentId" IS NULL AND "previousVersionId" IS NULL AND "currentVersionId" IS NULL)
    OR ("reason" = 'SOURCE_REPLACED' AND "replacementRevisionId" IS NULL
      AND "documentId" IS NOT NULL AND "previousVersionId" IS NOT NULL AND "currentVersionId" IS NOT NULL)
    OR ("reason" = 'SOURCE_DELETED' AND "replacementRevisionId" IS NULL
      AND "documentId" IS NOT NULL AND "previousVersionId" IS NOT NULL AND "currentVersionId" IS NULL)
  )
);
CREATE INDEX "approved_answer_invalidations_organizationId_answerId_createdAt_idx"
  ON "approved_answer_invalidations"("organizationId", "approvedAnswerId", "createdAt");
CREATE INDEX "approved_answer_invalidations_organizationId_documentId_createdAt_idx"
  ON "approved_answer_invalidations"("organizationId", "documentId", "createdAt");

CREATE FUNCTION enforce_approved_answer_invalidation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'approved answer invalidations are immutable';
END $$;
CREATE TRIGGER approved_answer_invalidation_immutable
  BEFORE UPDATE OR DELETE ON "approved_answer_invalidations"
  FOR EACH ROW EXECUTE FUNCTION enforce_approved_answer_invalidation_immutable();
