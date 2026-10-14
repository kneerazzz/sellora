CREATE TYPE "DraftProcessingStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'REFUSED', 'FAILED');
CREATE TYPE "DraftReviewStatus" AS ENUM ('REQUIRED', 'APPROVED', 'REJECTED');
CREATE TYPE "DraftDeliveryStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'SENT', 'FAILED');
CREATE TYPE "DraftRevisionOrigin" AS ENUM ('GENERATED', 'MANUAL');
CREATE TYPE "DraftApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

CREATE UNIQUE INDEX "users_id_organizationId_key" ON "users"("id", "organizationId");
CREATE UNIQUE INDEX "document_chunks_id_versionId_documentId_key"
  ON "document_chunks"("id", "versionId", "documentId");

CREATE TABLE "drafts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "title" TEXT,
  "question" TEXT NOT NULL,
  "requestedDocumentIds" TEXT[] NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "processingStatus" "DraftProcessingStatus" NOT NULL DEFAULT 'PROCESSING',
  "reviewStatus" "DraftReviewStatus" NOT NULL DEFAULT 'REQUIRED',
  "deliveryStatus" "DraftDeliveryStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "generationErrorCode" TEXT,
  "currentRevisionId" TEXT,
  "concurrencyToken" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "organizationId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  CONSTRAINT "drafts_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "drafts_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId")
    REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "drafts_state_check" CHECK (
    ("processingStatus" = 'FAILED' AND "generationErrorCode" IS NOT NULL)
    OR ("processingStatus" <> 'FAILED' AND "generationErrorCode" IS NULL)
  ),
  CONSTRAINT "drafts_revision_state_check" CHECK (
    "processingStatus" IN ('PROCESSING', 'FAILED') OR "currentRevisionId" IS NOT NULL
  ),
  CONSTRAINT "drafts_concurrency_token_check" CHECK ("concurrencyToken" >= 0)
);
CREATE UNIQUE INDEX "drafts_organizationId_idempotencyKey_key"
  ON "drafts"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "drafts_id_organizationId_key" ON "drafts"("id", "organizationId");
CREATE UNIQUE INDEX "drafts_currentRevisionId_id_organizationId_key"
  ON "drafts"("currentRevisionId", "id", "organizationId");
CREATE INDEX "drafts_organizationId_archivedAt_updatedAt_idx"
  ON "drafts"("organizationId", "archivedAt", "updatedAt");
CREATE INDEX "drafts_organizationId_processingStatus_updatedAt_idx"
  ON "drafts"("organizationId", "processingStatus", "updatedAt");

CREATE TABLE "draft_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revisionNumber" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "origin" "DraftRevisionOrigin" NOT NULL,
  "isRefusal" BOOLEAN NOT NULL DEFAULT false,
  "aiInteractionId" TEXT,
  "organizationId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  CONSTRAINT "draft_revisions_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "draft_revisions_draftId_organizationId_fkey" FOREIGN KEY ("draftId", "organizationId")
    REFERENCES "drafts"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "draft_revisions_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId")
    REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "draft_revisions_number_check" CHECK ("revisionNumber" > 0),
  CONSTRAINT "draft_revisions_content_check" CHECK (char_length("content") > 0)
);
CREATE UNIQUE INDEX "draft_revisions_draftId_revisionNumber_key"
  ON "draft_revisions"("draftId", "revisionNumber");
CREATE UNIQUE INDEX "draft_revisions_id_draftId_organizationId_key"
  ON "draft_revisions"("id", "draftId", "organizationId");
CREATE UNIQUE INDEX "draft_revisions_id_organizationId_key"
  ON "draft_revisions"("id", "organizationId");
CREATE INDEX "draft_revisions_organizationId_draftId_createdAt_idx"
  ON "draft_revisions"("organizationId", "draftId", "createdAt");

ALTER TABLE "drafts" ADD CONSTRAINT "drafts_currentRevisionId_id_organizationId_fkey"
  FOREIGN KEY ("currentRevisionId", "id", "organizationId")
  REFERENCES "draft_revisions"("id", "draftId", "organizationId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "draft_revision_sources" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ordinal" INTEGER NOT NULL,
  "organizationId" TEXT NOT NULL,
  "draftRevisionId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  CONSTRAINT "draft_revision_sources_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "draft_revision_sources_draftRevisionId_organizationId_fkey"
    FOREIGN KEY ("draftRevisionId", "organizationId")
    REFERENCES "draft_revisions"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "draft_revision_sources_documentId_organizationId_fkey"
    FOREIGN KEY ("documentId", "organizationId")
    REFERENCES "documents"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "draft_revision_sources_versionId_documentId_organizationId_fkey"
    FOREIGN KEY ("versionId", "documentId", "organizationId")
    REFERENCES "document_versions"("id", "documentId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "draft_revision_sources_chunkId_versionId_documentId_fkey"
    FOREIGN KEY ("chunkId", "versionId", "documentId")
    REFERENCES "document_chunks"("id", "versionId", "documentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "draft_revision_sources_ordinal_check" CHECK ("ordinal" >= 0)
);
CREATE UNIQUE INDEX "draft_revision_sources_draftRevisionId_ordinal_key"
  ON "draft_revision_sources"("draftRevisionId", "ordinal");
CREATE UNIQUE INDEX "draft_revision_sources_draftRevisionId_chunkId_key"
  ON "draft_revision_sources"("draftRevisionId", "chunkId");
CREATE INDEX "draft_revision_sources_organizationId_documentId_versionId_idx"
  ON "draft_revision_sources"("organizationId", "documentId", "versionId");

CREATE TABLE "draft_approvals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decision" "DraftApprovalDecision" NOT NULL,
  "note" TEXT,
  "organizationId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  CONSTRAINT "draft_approvals_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "draft_approvals_draftId_organizationId_fkey" FOREIGN KEY ("draftId", "organizationId")
    REFERENCES "drafts"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "draft_approvals_revisionId_draftId_organizationId_fkey"
    FOREIGN KEY ("revisionId", "draftId", "organizationId")
    REFERENCES "draft_revisions"("id", "draftId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "draft_approvals_reviewerId_organizationId_fkey" FOREIGN KEY ("reviewerId", "organizationId")
    REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "draft_approvals_organizationId_draftId_createdAt_idx"
  ON "draft_approvals"("organizationId", "draftId", "createdAt");
CREATE INDEX "draft_approvals_revisionId_createdAt_idx"
  ON "draft_approvals"("revisionId", "createdAt");

CREATE FUNCTION enforce_draft_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'draft revisions are immutable';
END $$;
CREATE TRIGGER draft_revision_immutable BEFORE UPDATE OR DELETE ON "draft_revisions"
  FOR EACH ROW EXECUTE FUNCTION enforce_draft_revision_immutable();

CREATE FUNCTION enforce_draft_revision_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'draft revision sources are immutable';
END $$;
CREATE TRIGGER draft_revision_source_immutable BEFORE UPDATE OR DELETE ON "draft_revision_sources"
  FOR EACH ROW EXECUTE FUNCTION enforce_draft_revision_source_immutable();

CREATE FUNCTION enforce_draft_approval_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'draft approvals are immutable';
END $$;
CREATE TRIGGER draft_approval_immutable BEFORE UPDATE OR DELETE ON "draft_approvals"
  FOR EACH ROW EXECUTE FUNCTION enforce_draft_approval_immutable();
