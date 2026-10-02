import { apiClient } from './client'
import type { ApiResponse } from '@/types/api'

export interface AnswerCitation {
  documentId: string
  documentName: string
  filename: string
  chunkId: string
  chunkIndex: number
  pageNumber: number | null
  snippet: string
}

export interface AnswerResult {
  answer: string
  refused: boolean
  citations: AnswerCitation[]
  aiInteractionId: string
}

export async function askQuestion(question: string) {
  const { data } = await apiClient.post<ApiResponse<AnswerResult>>('/ai/grounded-answers', {
    question,
    maxCitations: 5,
  })
  return data.data
}
