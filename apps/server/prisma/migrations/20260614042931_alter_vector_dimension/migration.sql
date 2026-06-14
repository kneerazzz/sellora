-- Alter the embedding column to 384 dimensions for all-minilm compatibility
ALTER TABLE "document_chunks" DROP COLUMN "embedding";
ALTER TABLE "document_chunks" ADD COLUMN "embedding" vector(384);