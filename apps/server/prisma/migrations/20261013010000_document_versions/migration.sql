ALTER TYPE "DocumentStatus" ADD VALUE IF NOT EXISTS 'DELETED';
CREATE TYPE "DocumentVersionStatus" AS ENUM ('BUILDING', 'ACTIVE', 'FAILED', 'RETIRED');

ALTER TABLE "documents"
  ADD COLUMN "activeVersionId" TEXT,
  ADD COLUMN "nextVersionNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "documents_id_organizationId_key" ON "documents"("id", "organizationId");

CREATE TABLE "document_versions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "documentId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "basedOnVersionId" TEXT,
  "contentHash" TEXT,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "fileType" "DocumentType" NOT NULL,
  "storagePath" TEXT NOT NULL,
  "status" "DocumentVersionStatus" NOT NULL DEFAULT 'BUILDING',
  "errorMessage" TEXT,
  "pageCount" INTEGER,
  "totalChunks" INTEGER,
  "embeddingModel" TEXT,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "document_versions_documentId_organizationId_fkey" FOREIGN KEY ("documentId", "organizationId")
    REFERENCES "documents"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_versions_organizationId_fkey" FOREIGN KEY ("organizationId")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_versions_content_hash_check" CHECK (
    ("id" = 'legacy-' || "documentId" AND "contentHash" IS NULL)
    OR ("id" <> 'legacy-' || "documentId" AND "contentHash" IS NOT NULL
      AND "contentHash" ~ '^[0-9a-f]{64}$')
  )
);
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");
CREATE UNIQUE INDEX "document_versions_id_documentId_key" ON "document_versions"("id", "documentId");
CREATE UNIQUE INDEX "document_versions_id_documentId_organizationId_key" ON "document_versions"("id", "documentId", "organizationId");
CREATE INDEX "document_versions_organizationId_documentId_idx" ON "document_versions"("organizationId", "documentId");

-- Historical original bytes are not accessible to SQL. Preserve paths and
-- vectors; mark their byte hash unknown instead of inventing a hash.
INSERT INTO "document_versions" (
  "id", "createdAt", "updatedAt", "documentId", "organizationId", "versionNumber",
  "contentHash", "filename", "mimeType", "sizeBytes", "fileType", "storagePath",
  "status", "errorMessage", "pageCount", "totalChunks", "embeddingModel", "publishedAt"
)
SELECT 'legacy-' || "id", "createdAt", "updatedAt", "id", "organizationId", 1,
  NULL, "filename", "mimeType", "sizeBytes", "fileType", "storagePath",
  CASE WHEN "status" = 'COMPLETED' THEN 'ACTIVE'::"DocumentVersionStatus" ELSE 'FAILED'::"DocumentVersionStatus" END,
  "errorMessage", "pageCount", "totalChunks", "embeddingModel",
  CASE WHEN "status" = 'COMPLETED' THEN "ingestedAt" ELSE NULL END
FROM "documents";

UPDATE "documents" SET
  "activeVersionId" = CASE WHEN "status" = 'COMPLETED' THEN 'legacy-' || "id" ELSE NULL END,
  "nextVersionNumber" = 2;

ALTER TABLE "document_chunks" ADD COLUMN "versionId" TEXT;
UPDATE "document_chunks" SET "versionId" = 'legacy-' || "documentId";
ALTER TABLE "document_chunks" ALTER COLUMN "versionId" SET NOT NULL;
DROP INDEX "document_chunks_documentId_chunkIndex_key";
CREATE UNIQUE INDEX "document_chunks_versionId_chunkIndex_key" ON "document_chunks"("versionId", "chunkIndex");
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_versionId_documentId_fkey"
  FOREIGN KEY ("versionId", "documentId") REFERENCES "document_versions"("id", "documentId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_activeVersionId_id_organizationId_fkey"
  FOREIGN KEY ("activeVersionId", "id", "organizationId")
  REFERENCES "document_versions"("id", "documentId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_deleted_status_check"
  CHECK ("deletedAt" IS NULL OR "status" = 'DELETED');

CREATE FUNCTION enforce_document_version_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."documentId" IS DISTINCT FROM OLD."documentId" OR
     NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR
     NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber" OR
     NEW."basedOnVersionId" IS DISTINCT FROM OLD."basedOnVersionId" OR
     NEW."contentHash" IS DISTINCT FROM OLD."contentHash" OR
     NEW."storagePath" IS DISTINCT FROM OLD."storagePath" OR
     NEW."filename" IS DISTINCT FROM OLD."filename" OR
     NEW."mimeType" IS DISTINCT FROM OLD."mimeType" OR
     NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes" OR
     NEW."fileType" IS DISTINCT FROM OLD."fileType" THEN
    RAISE EXCEPTION 'document version identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_version_identity_immutable BEFORE UPDATE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION enforce_document_version_identity();
