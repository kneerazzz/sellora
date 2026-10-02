/** The model and PostgreSQL vector column must share this contract. */
export const EMBEDDING_MODEL = 'nomic-embed-text'
export const EMBEDDING_DIMENSIONS = 768

export function validateEmbeddings(vectors: number[][], expectedCount: number): void {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new Error(`Embedding count mismatch: expected ${expectedCount}`)
  }
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS ||
        !vector.every((value) => typeof value === 'number' && Number.isFinite(value)) ||
        !vector.some((value) => value !== 0)) {
      throw new Error(`Invalid embedding: expected ${EMBEDDING_DIMENSIONS} finite values and a nonzero vector`)
    }
  }
}
