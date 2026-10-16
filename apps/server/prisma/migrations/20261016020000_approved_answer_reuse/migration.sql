ALTER TABLE "drafts"
  ADD COLUMN "reusedApprovedAnswerId" TEXT,
  ADD COLUMN "reusedApprovedAnswerRevisionId" TEXT;

CREATE INDEX "drafts_organizationId_reusedApprovedAnswerId_idx"
  ON "drafts"("organizationId", "reusedApprovedAnswerId");

ALTER TABLE "drafts" ADD CONSTRAINT "drafts_reusedApprovedAnswerId_organizationId_fkey"
  FOREIGN KEY ("reusedApprovedAnswerId", "organizationId")
  REFERENCES "approved_answers"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "drafts" ADD CONSTRAINT "drafts_reusedApprovedAnswerRevision_lineage_fkey"
  FOREIGN KEY ("reusedApprovedAnswerRevisionId", "reusedApprovedAnswerId", "organizationId")
  REFERENCES "approved_answer_revisions"("id", "approvedAnswerId", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "drafts" ADD CONSTRAINT "drafts_reuse_lineage_pair_check" CHECK (
  ("reusedApprovedAnswerId" IS NULL AND "reusedApprovedAnswerRevisionId" IS NULL)
  OR ("reusedApprovedAnswerId" IS NOT NULL AND "reusedApprovedAnswerRevisionId" IS NOT NULL)
);
