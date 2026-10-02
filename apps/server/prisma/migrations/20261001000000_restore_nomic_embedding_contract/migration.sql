-- Preserve previous vectors for audit/recovery; different models/dimensions cannot
-- be converted by padding. Re-ingest original source text with nomic-embed-text.
ALTER TABLE "document_chunks" RENAME COLUMN "embedding" TO "legacyEmbedding";
ALTER TABLE "document_chunks" ADD COLUMN "embedding" vector(768);

-- Existing completed content must not advertise readiness until rebuilt. Keep
-- original files, chunks and old model metadata intact for explicit re-ingestion.
UPDATE "documents"
SET "status" = 'FAILED',
    "errorMessage" = 'Embedding upgrade requires re-ingestion from original source using nomic-embed-text (768 dimensions).',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'COMPLETED';
