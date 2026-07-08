export interface EmbeddingProvider {
  /**
   * Generates embeddings for a list of texts.
   * @param texts An array of strings to embed.
   * @returns A promise that resolves to an array of embedding vectors.
   */
  embed(texts: string[], options?: { isQuery?: boolean }): Promise<number[][]>;
}
