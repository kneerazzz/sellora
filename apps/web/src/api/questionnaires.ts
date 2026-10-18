import { apiClient } from './client'
import type { ApiResponse } from '@/types/api'

export interface QuestionnaireRow {
  rowIndex: number
  rowId: string
  question: string
  status: string
  answer: string | null
  errorCode: string | null
  attemptCount: number
  draftId: string | null
  draft: { currentRevisionId: string | null; reviewStatus: string;
    currentRevision: { revisionNumber: number; content: string } | null } | null
}

export interface QuestionnaireJob {
  id: string
  createdAt: string
  format: string
  status: string
  rows: QuestionnaireRow[]
}

export async function listQuestionnaires() {
  const { data } = await apiClient.get<ApiResponse<Array<Pick<QuestionnaireJob, 'id' | 'createdAt' | 'format' | 'status'> & { _count: { rows: number } }>>>('/questionnaires')
  return data.data
}

export async function getQuestionnaire(id: string) {
  const { data } = await apiClient.get<ApiResponse<QuestionnaireJob>>(`/questionnaires/${id}`)
  return data.data
}

export async function createQuestionnaire(format: 'TEXT' | 'CSV', content: string) {
  const { data } = await apiClient.post<ApiResponse<QuestionnaireJob>>('/questionnaires', { format, content })
  return data.data
}

export async function retryQuestionnaireRow(id: string, rowIndex: number) {
  const { data } = await apiClient.post<ApiResponse<QuestionnaireJob>>(`/questionnaires/${id}/rows/${rowIndex}/retry`)
  return data.data
}

export async function cancelQuestionnaire(id: string) {
  const { data } = await apiClient.post<ApiResponse<QuestionnaireJob>>(`/questionnaires/${id}/cancel`)
  return data.data
}

export async function exportQuestionnaire(id: string, includeSources: boolean) {
  const { data } = await apiClient.get<Blob>(`/questionnaires/${id}/export`, {
    params: { includeSources }, responseType: 'blob',
  })
  return data
}
