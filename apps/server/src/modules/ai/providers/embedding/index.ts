import { EmbeddingProvider } from './EmbeddingProvider'
import { LocalEmbeddingProvider } from './LocalEmbeddingProvider'

let providerInstance: EmbeddingProvider | null = null

export function getEmbeddingProvider(): EmbeddingProvider {
  if (providerInstance) {
    return providerInstance
  }

  providerInstance = new LocalEmbeddingProvider()

  return providerInstance
}
