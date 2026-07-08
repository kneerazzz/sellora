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
  queryText: string
  topK?: number
  documentIds?: string[]
  minScore?: number
}): Promise<VectorSearchResult[]> {
  const { organizationId, queryVector, queryText } = params
  const topK = params.topK ?? 20
  const fetchK = topK * 3
  const minScore = params.minScore ?? 0.0

  const vectorStr = `[${queryVector.join(',')}]`
  
  let docFilter = Prisma.empty
  if (params.documentIds && params.documentIds.length > 0) {
    docFilter = Prisma.sql`AND d.id IN (${Prisma.join(params.documentIds)})`
  }

  const query = Prisma.sql`
    WITH semantic_search AS (
      SELECT
        dc.id,
        RANK() OVER (ORDER BY dc.embedding <=> ${vectorStr}::vector ASC) as vector_rank
      FROM document_chunks dc
      INNER JOIN documents d ON d.id = dc."documentId"
      WHERE d."organizationId" = ${organizationId}
        AND d.status = 'COMPLETED'
        AND dc.embedding IS NOT NULL
        ${docFilter}
      ORDER BY dc.embedding <=> ${vectorStr}::vector ASC
      LIMIT ${fetchK}
    ),
    keyword_search AS (
      SELECT
        dc.id,
        RANK() OVER (ORDER BY ts_rank(to_tsvector('english', dc.text), plainto_tsquery('english', ${queryText})) DESC) as keyword_rank
      FROM document_chunks dc
      INNER JOIN documents d ON d.id = dc."documentId"
      WHERE d."organizationId" = ${organizationId}
        AND d.status = 'COMPLETED'
        AND to_tsvector('english', dc.text) @@ plainto_tsquery('english', ${queryText})
        ${docFilter}
      ORDER BY ts_rank(to_tsvector('english', dc.text), plainto_tsquery('english', ${queryText})) DESC
      LIMIT ${fetchK}
    )
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
      COALESCE(1.0 / (60 + s.vector_rank), 0.0) + COALESCE(1.0 / (60 + k.keyword_rank), 0.0) AS score
    FROM document_chunks dc
    INNER JOIN documents d ON d.id = dc."documentId"
    LEFT JOIN semantic_search s ON s.id = dc.id
    LEFT JOIN keyword_search k ON k.id = dc.id
    WHERE s.id IS NOT NULL OR k.id IS NOT NULL
    ORDER BY score DESC
    LIMIT ${topK}
  `

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
