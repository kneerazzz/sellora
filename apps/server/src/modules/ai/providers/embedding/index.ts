import { EmbeddingProvider } from './EmbeddingProvider'
import { LocalEmbeddingProvider } from './LocalEmbeddingProvider'
import { OpenAIEmbeddingProvider } from './OpenAIEmbeddingProvider'
import { env } from '../../../../config/env'

let providerInstance: EmbeddingProvider | null = null

export function getEmbeddingProvider(): EmbeddingProvider {
  if (providerInstance) {
    return providerInstance
  }

  const providerType = env.EMBEDDING_PROVIDER || 'local'

  if (providerType === 'openai') {
    providerInstance = new OpenAIEmbeddingProvider()
  } else {
    // Default to local
    providerInstance = new LocalEmbeddingProvider()
  }

  return providerInstance
}
