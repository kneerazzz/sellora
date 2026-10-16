CREATE UNIQUE INDEX "draft_approvals_id_organizationId_key"
  ON "draft_approvals"("id", "organizationId");

CREATE TABLE "approved_answers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "title" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL,
  "reviewStatus" "DraftReviewStatus" NOT NULL DEFAULT 'APPROVED',
  "currentRevisionId" TEXT,
  "concurrencyToken" INTEGER NOT NULL DEFAULT 1,
  "archivedAt" TIMESTAMP(3),
  "organizationId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  CONSTRAINT "approved_answers_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approved_answers_ownerId_organizationId_fkey" FOREIGN KEY ("ownerId", "organizationId")
    REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answers_concurrency_token_check" CHECK ("concurrencyToken" > 0),
  CONSTRAINT "approved_answers_title_check" CHECK (char_length("title") > 0),
  CONSTRAINT "approved_answers_question_check" CHECK (char_length("question") > 0)
);
CREATE UNIQUE INDEX "approved_answers_id_organizationId_key"
  ON "approved_answers"("id", "organizationId");
CREATE UNIQUE INDEX "approved_answers_currentRevisionId_id_organizationId_key"
  ON "approved_answers"("currentRevisionId", "id", "organizationId");
CREATE INDEX "approved_answers_organizationId_archivedAt_updatedAt_idx"
  ON "approved_answers"("organizationId", "archivedAt", "updatedAt");
CREATE INDEX "approved_answers_organizationId_reviewStatus_updatedAt_idx"
  ON "approved_answers"("organizationId", "reviewStatus", "updatedAt");

CREATE TABLE "approved_answer_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revisionNumber" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL,
  "organizationId" TEXT NOT NULL,
  "approvedAnswerId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "sourceDraftRevisionId" TEXT,
  CONSTRAINT "approved_answer_revisions_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_revisions_approvedAnswerId_organizationId_fkey"
    FOREIGN KEY ("approvedAnswerId", "organizationId")
    REFERENCES "approved_answers"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_revisions_authorId_organizationId_fkey"
    FOREIGN KEY ("authorId", "organizationId")
    REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_revisions_sourceDraftRevisionId_organizationId_fkey"
    FOREIGN KEY ("sourceDraftRevisionId", "organizationId")
    REFERENCES "draft_revisions"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_revisions_number_check" CHECK ("revisionNumber" > 0),
  CONSTRAINT "approved_answer_revisions_title_check" CHECK (char_length("title") > 0),
  CONSTRAINT "approved_answer_revisions_question_check" CHECK (char_length("question") > 0),
  CONSTRAINT "approved_answer_revisions_content_check" CHECK (char_length("content") > 0)
);
CREATE UNIQUE INDEX "approved_answer_revisions_approvedAnswerId_revisionNumber_key"
  ON "approved_answer_revisions"("approvedAnswerId", "revisionNumber");
CREATE UNIQUE INDEX "approved_answer_revisions_id_approvedAnswerId_organizationId_key"
  ON "approved_answer_revisions"("id", "approvedAnswerId", "organizationId");
CREATE UNIQUE INDEX "approved_answer_revisions_id_organizationId_key"
  ON "approved_answer_revisions"("id", "organizationId");
CREATE UNIQUE INDEX "approved_answer_revisions_organizationId_sourceDraftRevisionId_key"
  ON "approved_answer_revisions"("organizationId", "sourceDraftRevisionId");
CREATE INDEX "approved_answer_revisions_organizationId_approvedAnswerId_createdAt_idx"
  ON "approved_answer_revisions"("organizationId", "approvedAnswerId", "createdAt");

ALTER TABLE "approved_answers" ADD CONSTRAINT "approved_answers_currentRevisionId_id_organizationId_fkey"
  FOREIGN KEY ("currentRevisionId", "id", "organizationId")
  REFERENCES "approved_answer_revisions"("id", "approvedAnswerId", "organizationId")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "approved_answer_revision_sources" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ordinal" INTEGER NOT NULL,
  "organizationId" TEXT NOT NULL,
  "approvedAnswerRevisionId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  CONSTRAINT "approved_answer_revision_sources_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_revision_sources_revisionId_organizationId_fkey"
    FOREIGN KEY ("approvedAnswerRevisionId", "organizationId")
    REFERENCES "approved_answer_revisions"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_revision_sources_documentId_organizationId_fkey"
    FOREIGN KEY ("documentId", "organizationId")
    REFERENCES "documents"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_revision_sources_versionId_documentId_organizationId_fkey"
    FOREIGN KEY ("versionId", "documentId", "organizationId")
    REFERENCES "document_versions"("id", "documentId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_revision_sources_chunkId_versionId_documentId_fkey"
    FOREIGN KEY ("chunkId", "versionId", "documentId")
    REFERENCES "document_chunks"("id", "versionId", "documentId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_revision_sources_ordinal_check" CHECK ("ordinal" >= 0)
);
CREATE UNIQUE INDEX "approved_answer_revision_sources_revisionId_ordinal_key"
  ON "approved_answer_revision_sources"("approvedAnswerRevisionId", "ordinal");
CREATE UNIQUE INDEX "approved_answer_revision_sources_revisionId_chunkId_key"
  ON "approved_answer_revision_sources"("approvedAnswerRevisionId", "chunkId");
CREATE INDEX "approved_answer_revision_sources_organizationId_documentId_versionId_idx"
  ON "approved_answer_revision_sources"("organizationId", "documentId", "versionId");

CREATE TABLE "approved_answer_approvals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  "decision" "DraftApprovalDecision" NOT NULL,
  "note" TEXT,
  "organizationId" TEXT NOT NULL,
  "approvedAnswerId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "reviewerId" TEXT NOT NULL,
  "sourceDraftApprovalId" TEXT,
  CONSTRAINT "approved_answer_approvals_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_approvals_approvedAnswerId_organizationId_fkey"
    FOREIGN KEY ("approvedAnswerId", "organizationId")
    REFERENCES "approved_answers"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_approvals_revisionId_answerId_organizationId_fkey"
    FOREIGN KEY ("revisionId", "approvedAnswerId", "organizationId")
    REFERENCES "approved_answer_revisions"("id", "approvedAnswerId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_approvals_reviewerId_organizationId_fkey"
    FOREIGN KEY ("reviewerId", "organizationId")
    REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "approved_answer_approvals_sourceDraftApprovalId_organizationId_fkey"
    FOREIGN KEY ("sourceDraftApprovalId", "organizationId")
    REFERENCES "draft_approvals"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "approved_answer_approvals_organizationId_answerId_createdAt_idx"
  ON "approved_answer_approvals"("organizationId", "approvedAnswerId", "createdAt");
CREATE INDEX "approved_answer_approvals_revisionId_createdAt_idx"
  ON "approved_answer_approvals"("revisionId", "createdAt");

CREATE FUNCTION enforce_approved_answer_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'approved answer revisions are immutable';
END $$;
CREATE TRIGGER approved_answer_revision_immutable
  BEFORE UPDATE OR DELETE ON "approved_answer_revisions"
  FOR EACH ROW EXECUTE FUNCTION enforce_approved_answer_revision_immutable();

CREATE FUNCTION enforce_approved_answer_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'approved answer revision sources are immutable';
END $$;
CREATE TRIGGER approved_answer_source_immutable
  BEFORE UPDATE OR DELETE ON "approved_answer_revision_sources"
  FOR EACH ROW EXECUTE FUNCTION enforce_approved_answer_source_immutable();

CREATE FUNCTION enforce_approved_answer_approval_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'approved answer approvals are immutable';
END $$;
CREATE TRIGGER approved_answer_approval_immutable
  BEFORE UPDATE OR DELETE ON "approved_answer_approvals"
  FOR EACH ROW EXECUTE FUNCTION enforce_approved_answer_approval_immutable();
