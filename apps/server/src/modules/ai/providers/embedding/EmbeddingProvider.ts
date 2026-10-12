import type { ProviderOperationControls } from '../../../../services/provider/providerTransport'

export type EmbeddingOptions = ProviderOperationControls & {
  isQuery?: boolean
}

export interface EmbeddingProvider {
  /**
   * Generates embeddings for a list of texts.
   * @param texts An array of strings to embed.
   * @returns A promise that resolves to an array of embedding vectors.
   */
  embed(texts: string[], options?: EmbeddingOptions): Promise<number[][]>
}
