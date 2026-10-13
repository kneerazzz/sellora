import type { Prisma } from '@prisma/client'
import type { ChunkedBlock } from '../../services/document/chunking.service'
import { EMBEDDING_MODEL, validateEmbeddings } from '../../utils/embeddingContract'
import { ApiError } from '../../utils/apiError'

type VectorWriter = (chunks: Array<{ id: string; embedding: number[] }>, tx: Prisma.TransactionClient) => Promise<void>

/** Chunk/vector writes and the active pointer publish or roll back together. */
export async function persistIngestedChunks(
  tx: Prisma.TransactionClient,
  params: {
    documentId: string
    versionId: string
    expectedActiveVersionId: string | null
    chunks: ChunkedBlock[]
    embeddings: number[][] | null
    pageCount?: number
  },
  writeVectors: VectorWriter,
) {
  const { documentId, versionId, chunks, embeddings } = params
  if (chunks.length === 0) throw new Error('Cannot persist an empty document')
  if (embeddings !== null) validateEmbeddings(embeddings, chunks.length)

  const version = await tx.documentVersion.findUniqueOrThrow({ where: { id: versionId } })
  if (version.documentId !== documentId || version.status !== 'BUILDING') {
    throw ApiError.conflict('Document candidate is no longer buildable')
  }
  await tx.documentChunk.createMany({ data: chunks.map(chunk => ({ ...chunk, documentId, versionId })) })
  if (embeddings !== null) {
    const created = await tx.documentChunk.findMany({
      where: { versionId }, select: { id: true, chunkIndex: true }, orderBy: { chunkIndex: 'asc' },
    })
    if (created.length !== chunks.length) throw new Error('Persisted chunk count mismatch')
    const byIndex = new Map(chunks.map((chunk, index) => [chunk.chunkIndex, embeddings[index]!]))
    await writeVectors(created.map(chunk => {
      const embedding = byIndex.get(chunk.chunkIndex)
      if (!embedding) throw new Error('Persisted chunk index mismatch')
      return { id: chunk.id, embedding }
    }), tx)
  }

  const now = new Date()
  const published = await tx.document.updateMany({
    where: { id: documentId, organizationId: version.organizationId,
      activeVersionId: params.expectedActiveVersionId, deletedAt: null },
    data: {
      activeVersionId: versionId, status: 'COMPLETED', errorMessage: null,
      filename: version.filename, mimeType: version.mimeType,
      sizeBytes: version.sizeBytes, fileType: version.fileType,
      storagePath: version.storagePath, pageCount: params.pageCount ?? null,
      totalChunks: chunks.length, embeddingModel: embeddings !== null ? EMBEDDING_MODEL : null,
      ingestedAt: now,
    },
  })
  if (published.count !== 1) throw ApiError.conflict('Active document version changed during replacement')
  if (params.expectedActiveVersionId) await tx.documentVersion.updateMany({
    where: { id: params.expectedActiveVersionId, documentId, status: 'ACTIVE' },
    data: { status: 'RETIRED' },
  })
  await tx.documentVersion.update({ where: { id: versionId }, data: {
    status: 'ACTIVE', totalChunks: chunks.length,
    embeddingModel: embeddings !== null ? EMBEDDING_MODEL : null,
    pageCount: params.pageCount ?? null, publishedAt: now, errorMessage: null,
  } })
  return tx.document.findUniqueOrThrow({ where: { id: documentId } })
}
