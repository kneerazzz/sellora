import { AutoTokenizer, AutoModelForSequenceClassification, env } from '@xenova/transformers'
import { env as appEnv } from '../config/env'
import {
  ProviderOperationError,
  waitForUncancellableProviderWork,
  type ProviderOperationControls,
} from '../services/provider/providerTransport'
import { createUsageAttemptObserver, recordUsageQuantities } from '../modules/usage/usageLedger.service'

env.allowLocalModels = false // Use huggingface hub

export type RankedResult<T> = {
  item: T
  combinedScore: number
}

let tokenizerInstance: any = null
let modelInstance: any = null

async function getReranker() {
  if (!tokenizerInstance || !modelInstance) {
    const model_id = 'Xenova/bge-reranker-base'
    tokenizerInstance = await AutoTokenizer.from_pretrained(model_id)
    modelInstance = await AutoModelForSequenceClassification.from_pretrained(model_id, { quantized: true })
  }
  return { tokenizer: tokenizerInstance, model: modelInstance }
}

export async function rerank<T>(params: {
  items: Array<{ item: T; score: number }>
  question: string
  getText: (item: T) => string
  limit: number
  operation?: ProviderOperationControls
  dependencies?: { loadReranker?: typeof getReranker }
}): Promise<RankedResult<T>[]> {
  const { items, question, getText, limit, operation } = params

  if (items.length === 0) {
    return []
  }
  const inputCharacters = question.length + items.reduce((total, entry) => total + getText(entry.item).length, 0)
  if (inputCharacters > appEnv.PROVIDER_INPUT_MAX_CHARS) {
    throw new ProviderOperationError('Reranker input exceeded the configured character limit', 'validation', [], false)
  }

  try {
    const ranked = await waitForUncancellableProviderWork({
      timeoutMs: appEnv.PROVIDER_OPERATION_TIMEOUT_MS,
      controls: operation?.usage ? {
        ...operation,
        attemptObserver: createUsageAttemptObserver({
          traceId: operation.usage.traceId,
          component: 'reranker',
          category: 'LOCAL_COMPUTE',
          provider: 'xenova',
          model: 'Xenova/bge-reranker-base',
        }),
      } : operation,
      work: async () => {
        const { tokenizer, model } = await (params.dependencies?.loadReranker ?? getReranker)()

        const rankedPromises = items.map(async (entry) => {
          const text = getText(entry.item)
          const inputs = tokenizer(question, { text_pair: text })
          const { logits } = await model(inputs)
          const score = logits.data[0]
          if (typeof score !== 'number' || !Number.isFinite(score)) {
            throw new ProviderOperationError('Reranker response failed validation', 'validation', [], false)
          }
          return { item: entry.item, combinedScore: score }
        })

        const ranked = await Promise.all(rankedPromises)

        ranked.sort((a, b) => b.combinedScore - a.combinedScore)

        return ranked.slice(0, limit)
      },
    })
    if (operation?.usage) {
      await recordUsageQuantities({
        traceId: operation.usage.traceId, component: 'reranker', attemptNumber: 1,
        inputQuantity: inputCharacters, outputQuantity: 0, totalQuantity: inputCharacters,
        unitType: 'CHARACTERS', measurementStatus: 'ESTIMATED',
      })
    }
    return ranked
  } catch (error) {
    if (error instanceof ProviderOperationError) throw error
    throw new ProviderOperationError('Reranker work failed', 'transport', [], false, undefined, { cause: error })
  }
}
