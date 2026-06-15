import { prisma } from '../config/prisma'
import { Prisma } from '@prisma/client'
import { env } from '../config/env'

export type VectorSearchResult = {
  chunkId: string
  text: string
  chunkIndex: number
  pageNumber: number | null
  headingPath: string[]
  sectionTitle: string | null
  documentId: string
  displayName: string
  filename: string
  score: number
}

const UPSERT_BATCH_SIZE = 100

export async function upsertChunkEmbeddings(
  chunks: Array<{ id: string; embedding: number[] }>
): Promise<void> {
  for (let i = 0; i < chunks.length; i += UPSERT_BATCH_SIZE) {
    const batch = chunks.slice(i, i + UPSERT_BATCH_SIZE)

    await Promise.all(
      batch.map((chunk) => {
        const vectorStr = `[${chunk.embedding.join(',')}]`
        return prisma.$executeRawUnsafe(
          `UPDATE document_chunks SET embedding = $1::vector WHERE id = $2`,
          vectorStr,
          chunk.id
        )
      })
    )
  }
}

export async function searchSimilarChunks(params: {
  organizationId: string
  queryVector: number[]
  topK?: number
  documentIds?: string[]
  minScore?: number
}): Promise<VectorSearchResult[]> {
  const { organizationId, queryVector } = params
  const topK = params.topK ?? 20
  const minScore = params.minScore ?? 0.15

  const vectorStr = `[${queryVector.join(',')}]`

  let query = Prisma.sql`
    SELECT
      dc.id AS "chunkId",
      dc.text,
      dc."chunkIndex",
      dc."pageNumber",
      dc."headingPath",
      dc."sectionTitle",
      dc."documentId",
      d."displayName",
      d.filename,
      1 - (dc.embedding <=> ${vectorStr}::vector) AS score
    FROM document_chunks dc
    INNER JOIN documents d ON d.id = dc."documentId"
    WHERE d."organizationId" = ${organizationId}
      AND d.status = 'COMPLETED'
      AND dc.embedding IS NOT NULL
  `

  if (params.documentIds && params.documentIds.length > 0) {
    query = Prisma.sql`${query} AND dc."documentId" IN (${Prisma.join(params.documentIds)})`
  }

  query = Prisma.sql`${query} ORDER BY dc.embedding <=> ${vectorStr}::vector ASC LIMIT ${topK}`

  const rows = await prisma.$queryRaw<
    Array<{
      chunkId: string
      text: string
      chunkIndex: number
      pageNumber: number | null
      headingPath: string[]
      sectionTitle: string | null
      documentId: string
      displayName: string
      filename: string
      score: number
    }>
  >(query)

  return rows.filter((row) => row.score >= minScore)
}

export function hasEmbeddingsConfigured(): boolean {
  return env.EMBEDDING_PROVIDER === 'local' || !!env.OPENAI_API_KEY
}
