import { EMBEDDING_MODEL, validateEmbeddings } from '../../../../utils/embeddingContract'
import { EmbeddingProvider, type EmbeddingOptions } from './EmbeddingProvider'
import { ApiError } from '../../../../utils/apiError'
import { env } from '../../../../config/env'
import { OllamaEmbedding } from '@llamaindex/ollama'
import {
  ProviderOperationError,
  waitForUncancellableProviderWork,
  type ProviderTransportDependencies,
} from '../../../../services/provider/providerTransport'
import { createUsageAttemptObserver, recordUsageQuantities } from '../../../usage/usageLedger.service'

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private readonly embedModel: Pick<OllamaEmbedding, 'getTextEmbeddings'>
  private readonly timing?: Pick<ProviderTransportDependencies, 'now' | 'sleep'>

  constructor(dependencies: {
    embedModel?: Pick<OllamaEmbedding, 'getTextEmbeddings'>
    timing?: Pick<ProviderTransportDependencies, 'now' | 'sleep'>
  } = {}) {
    const url = env.LOCAL_EMBEDDING_SERVICE_URL || 'http://127.0.0.1:11435'
    this.embedModel = dependencies.embedModel ?? new OllamaEmbedding({
      model: EMBEDDING_MODEL,
      config: { host: url },
    })
    this.timing = dependencies.timing
  }

  public async embed(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }
    if (texts.reduce((total, text) => total + text.length, 0) > env.PROVIDER_INPUT_MAX_CHARS) {
      throw new ProviderOperationError('Embedding input exceeded the configured character limit', 'validation', [], false)
    }

    // Nomic requires specific prefixes for best performance
    const prefix = options?.isQuery ? 'search_query: ' : 'search_document: '
    const prefixedTexts = texts.map(t => prefix + t)

    try {
      const vectors = await waitForUncancellableProviderWork({
        timeoutMs: env.PROVIDER_OPERATION_TIMEOUT_MS,
        controls: options?.usage ? {
          ...options,
          attemptObserver: createUsageAttemptObserver({
            traceId: options.usage.traceId,
            component: 'embedding',
            category: 'LOCAL_COMPUTE',
            provider: 'ollama',
            model: EMBEDDING_MODEL,
          }),
        } : options,
        dependencies: this.timing,
        work: async () => {
          const embeddings = await this.embedModel.getTextEmbeddings(prefixedTexts)
          try {
            validateEmbeddings(embeddings, texts.length)
          } catch (error) {
            throw new ProviderOperationError('Local embedding response failed validation', 'validation', [], false, undefined, { cause: error })
          }
          return embeddings
        },
      })
      if (options?.usage) {
        const characters = texts.reduce((total, text) => total + text.length, 0)
        await recordUsageQuantities({
          traceId: options.usage.traceId, component: 'embedding', attemptNumber: 1,
          inputQuantity: characters, outputQuantity: 0, totalQuantity: characters,
          unitType: 'CHARACTERS', measurementStatus: 'ESTIMATED',
        })
      }
      return vectors
    } catch (error: any) {
      if (error instanceof ProviderOperationError) throw error
      console.error('LocalEmbeddingProvider error:', error)
      throw ApiError.internal(`Failed to generate embeddings from local Ollama service. ${error.message}`)
    }
  }
}
