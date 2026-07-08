import { AutoTokenizer, AutoModelForSequenceClassification, env } from '@xenova/transformers'

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
}): Promise<RankedResult<T>[]> {
  const { items, question, getText, limit } = params

  if (items.length === 0) {
    return []
  }

  try {
    const { tokenizer, model } = await getReranker()

    const rankedPromises = items.map(async (entry) => {
      const text = getText(entry.item)
      const inputs = tokenizer(question, { text_pair: text })
      const { logits } = await model(inputs)
      const score = logits.data[0]
      return {
        item: entry.item,
        combinedScore: score,
      }
    })

    const ranked = await Promise.all(rankedPromises)

    // Sort descending by combined score (cross encoder logit)
    ranked.sort((a, b) => b.combinedScore - a.combinedScore)

    return ranked.slice(0, limit)
  } catch (error) {
    console.error('Cross-encoder reranking failed, falling back to original scores:', error)
    const fallbackRanked = [...items].sort((a, b) => b.score - a.score)
    return fallbackRanked.slice(0, limit).map((entry) => ({
      item: entry.item,
      combinedScore: entry.score,
    }))
  }
}
