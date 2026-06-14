/*
  Warnings:

  - You are about to drop the column `pineconeQueryVector` on the `ai_interactions` table. All the data in the column will be lost.
  - You are about to drop the column `pineconeId` on the `document_chunks` table. All the data in the column will be lost.
  - You are about to drop the column `pineconeIds` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the column `pineconeNamespace` on the `organizations` table. All the data in the column will be lost.

*/
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- DropIndex
DROP INDEX "document_chunks_pineconeId_idx";

-- AlterTable
ALTER TABLE "ai_interactions" DROP COLUMN "pineconeQueryVector",
ADD COLUMN     "queryVector" DOUBLE PRECISION[];

-- AlterTable
ALTER TABLE "document_chunks" DROP COLUMN "pineconeId",
ADD COLUMN     "embedding" vector(1536),
ADD COLUMN     "headingPath" TEXT[],
ADD COLUMN     "overlapTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sectionTitle" TEXT;

-- AlterTable
ALTER TABLE "documents" DROP COLUMN "pineconeIds";

-- AlterTable
ALTER TABLE "organizations" DROP COLUMN "pineconeNamespace";
