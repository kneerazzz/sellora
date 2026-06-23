import { apiClient } from './client'
import type { ApiResponse, Document } from '@/types/api'

export async function listDocuments(params?: {
  page?: number
  limit?: number
  status?: string
  search?: string
}) {
  const { data } = await apiClient.get<ApiResponse<Document[]>>('/documents', { params })
  return { items: data.data, meta: data.meta }
}

export async function uploadDocumentFile(file: File, fields?: { displayName?: string; description?: string }) {
  const formData = new FormData()
  formData.append('file', file)
  if (fields?.displayName) formData.append('displayName', fields.displayName)
  if (fields?.description) formData.append('description', fields.description)

  const { data } = await apiClient.post<ApiResponse<Document>>('/documents/upload-file', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data.data
}
