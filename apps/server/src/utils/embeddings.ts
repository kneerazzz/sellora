import { validateEmbeddings } from './embeddingContract'
import { getEmbeddingProvider } from '../modules/ai/providers/embedding'

/**
 * Generates embeddings for a list of texts using the configured provider.
 * This maintains the existing interface while moving to the new provider abstraction.
 */
export async function getEmbeddings(texts: string[], options?: { isQuery?: boolean }): Promise<number[][]> {
  const provider = getEmbeddingProvider()
  const vectors = await provider.embed(texts, options)
  validateEmbeddings(vectors, texts.length)
  return vectors
}
