import { EmbeddingProvider } from './EmbeddingProvider'
import { ApiError } from '../../../../utils/apiError'
import { env } from '../../../../config/env'
import { OllamaEmbedding } from '@llamaindex/ollama'

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private readonly embedModel: OllamaEmbedding

  constructor() {
    const url = env.LOCAL_EMBEDDING_SERVICE_URL || 'http://127.0.0.1:11435'
    // Extract host from url, since Ollama config takes host config
    this.embedModel = new OllamaEmbedding({
      model: 'nomic-embed-text',
      config: {
        host: url,
      },
    })
  }

  public async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }

    try {
      const embeddings = await this.embedModel.getTextEmbeddings(texts)
      return embeddings
    } catch (error: any) {
      console.error('LocalEmbeddingProvider error:', error)
      throw ApiError.internal(`Failed to generate embeddings from local Ollama service. ${error.message}`)
    }
  }
}
