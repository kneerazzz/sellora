import { tokenizeForRetrieval, scoreByTokenOverlap } from './localRetrieval'

export type RankedResult<T> = {
  item: T
  vectorScore: number
  keywordScore: number
  combinedScore: number
}

export function rerank<T>(params: {
  items: Array<{ item: T; score: number }>
  question: string
  getText: (item: T) => string
  limit: number
  vectorWeight?: number
}): RankedResult<T>[] {
  const { items, question, getText, limit } = params
  const vectorWeight = params.vectorWeight ?? 0.7
  const keywordWeight = 1 - vectorWeight

  if (items.length === 0) {
    return []
  }

  const questionTokens = tokenizeForRetrieval(question)

  // Compute raw keyword scores
  const entries = items.map((entry) => ({
    item: entry.item,
    rawVectorScore: entry.score,
    rawKeywordScore: scoreByTokenOverlap(questionTokens, getText(entry.item)),
  }))

  // Find max scores for normalization
  const maxVector = Math.max(...entries.map((e) => e.rawVectorScore)) || 1
  const maxKeyword = Math.max(...entries.map((e) => e.rawKeywordScore)) || 1

  // Normalize and compute combined score
  const ranked: RankedResult<T>[] = entries.map((entry) => {
    const normalizedVector = entry.rawVectorScore / maxVector
    const normalizedKeyword = entry.rawKeywordScore / maxKeyword
    const combinedScore = vectorWeight * normalizedVector + keywordWeight * normalizedKeyword

    return {
      item: entry.item,
      vectorScore: normalizedVector,
      keywordScore: normalizedKeyword,
      combinedScore,
    }
  })

  // Sort descending by combined score
  ranked.sort((a, b) => b.combinedScore - a.combinedScore)

  return ranked.slice(0, limit)
}
