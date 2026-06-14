import { EmbeddingProvider } from './EmbeddingProvider'
import { ApiError } from '../../../../utils/apiError'

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  public async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }
    
    // TODO: Implement OpenAI embeddings API call.
    // Example:
    // const response = await fetch('https://api.openai.com/v1/embeddings', ...)
    // ... parse response and return vectors ...
    throw ApiError.internal('OpenAI embeddings provider is not fully implemented yet.')
  }
}
