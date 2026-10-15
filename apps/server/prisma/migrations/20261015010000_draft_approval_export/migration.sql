CREATE TABLE "draft_export_requests" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "includeSources" BOOLEAN NOT NULL DEFAULT false,
  "organizationId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "revisionId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL,
  CONSTRAINT "draft_export_requests_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "draft_export_requests_draftId_organizationId_fkey" FOREIGN KEY ("draftId", "organizationId")
    REFERENCES "drafts"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "draft_export_requests_revisionId_draftId_organizationId_fkey"
    FOREIGN KEY ("revisionId", "draftId", "organizationId")
    REFERENCES "draft_revisions"("id", "draftId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "draft_export_requests_requesterId_organizationId_fkey" FOREIGN KEY ("requesterId", "organizationId")
    REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "draft_export_requests_organizationId_draftId_createdAt_idx"
  ON "draft_export_requests"("organizationId", "draftId", "createdAt");

CREATE TABLE "draft_copy_confirmations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exportId" TEXT NOT NULL,
  CONSTRAINT "draft_copy_confirmations_exportId_fkey" FOREIGN KEY ("exportId")
    REFERENCES "draft_export_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "draft_copy_confirmations_exportId_createdAt_idx"
  ON "draft_copy_confirmations"("exportId", "createdAt");

CREATE FUNCTION enforce_draft_export_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'draft export audit records are immutable';
END $$;
CREATE TRIGGER draft_export_request_immutable BEFORE UPDATE OR DELETE ON "draft_export_requests"
  FOR EACH ROW EXECUTE FUNCTION enforce_draft_export_audit_immutable();
CREATE TRIGGER draft_copy_confirmation_immutable BEFORE UPDATE OR DELETE ON "draft_copy_confirmations"
  FOR EACH ROW EXECUTE FUNCTION enforce_draft_export_audit_immutable();
