import type { Prisma } from '@prisma/client'
import type { ChunkedBlock } from '../../services/document/chunking.service'
import { EMBEDDING_MODEL, validateEmbeddings } from '../../utils/embeddingContract'

type VectorWriter = (chunks: Array<{ id: string; embedding: number[] }>, tx: Prisma.TransactionClient) => Promise<void>

/** Called inside one transaction: replacement, vectors and ready state commit together. */
export async function persistIngestedChunks(
  tx: Prisma.TransactionClient,
  params: {
    documentId: string
    chunks: ChunkedBlock[]
    embeddings: number[][] | null
    isReingest?: boolean
    pageCount?: number
  },
  writeVectors: VectorWriter,
) {
  const { documentId, chunks, embeddings } = params
  if (chunks.length === 0) throw new Error('Cannot persist an empty document')
  if (embeddings !== null) validateEmbeddings(embeddings, chunks.length)

  if (params.isReingest) await tx.documentChunk.deleteMany({ where: { documentId } })
  await tx.documentChunk.createMany({
    data: chunks.map((chunk) => ({ ...chunk, documentId })),
  })
  if (embeddings !== null) {
    const created = await tx.documentChunk.findMany({
      where: { documentId }, select: { id: true, chunkIndex: true }, orderBy: { chunkIndex: 'asc' },
    })
    if (created.length !== chunks.length) throw new Error('Persisted chunk count mismatch')
    const byIndex = new Map(chunks.map((chunk, index) => [chunk.chunkIndex, embeddings[index]!]))
    await writeVectors(created.map((chunk) => {
      const embedding = byIndex.get(chunk.chunkIndex)
      if (!embedding) throw new Error('Persisted chunk index mismatch')
      return { id: chunk.id, embedding }
    }), tx)
  }
  return tx.document.update({
    where: { id: documentId },
    data: {
      status: 'COMPLETED', totalChunks: chunks.length,
      embeddingModel: embeddings !== null ? EMBEDDING_MODEL : null,
      ingestedAt: new Date(), errorMessage: null,
      ...(params.pageCount !== undefined ? { pageCount: params.pageCount } : {}),
    },
  })
}
