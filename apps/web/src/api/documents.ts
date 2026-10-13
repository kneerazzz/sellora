import { apiClient } from './client'
import type { ApiResponse, Document, DocumentVersion, SourceInspection } from '@/types/api'

export async function listDocuments(params?: {
  page?: number
  limit?: number
  status?: string
  search?: string
}) {
  const { data } = await apiClient.get<ApiResponse<Document[]>>('/documents', { params })
  return { items: data.data, meta: data.meta }
}

export async function uploadDocumentFile(file: File, fields?: { displayName?: string; description?: string }, signal?: AbortSignal) {
  const formData = new FormData()
  formData.append('file', file)
  if (fields?.displayName) formData.append('displayName', fields.displayName)
  if (fields?.description) formData.append('description', fields.description)

  const { data } = await apiClient.post<ApiResponse<Document>>('/documents/upload-file', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    signal,
  })
  return data.data
}

export async function listDocumentVersions(documentId: string) {
  const { data } = await apiClient.get<ApiResponse<DocumentVersion[]>>(`/documents/${documentId}/versions`)
  return data.data
}

export async function inspectDocumentVersion(documentId: string, versionId: string) {
  const { data } = await apiClient.get<ApiResponse<SourceInspection>>(`/documents/${documentId}/versions/${versionId}/source`)
  return data.data
}

export async function replaceDocumentFile(documentId: string, expectedActiveVersionId: string | null,
  file: File, signal?: AbortSignal) {
  const form = new FormData()
  form.set('file', file)
  form.set('expectedActiveVersionId', expectedActiveVersionId ?? 'null')
  const { data } = await apiClient.post<ApiResponse<Document>>(`/documents/${documentId}/replace-file`, form,
    { headers: { 'Content-Type': 'multipart/form-data' }, signal })
  return data.data
}

export async function retryDocumentVersion(documentId: string, versionId: string) {
  const { data } = await apiClient.post<ApiResponse<Document>>(`/documents/${documentId}/versions/${versionId}/retry`, {})
  return data.data
}

export async function deleteDocument(documentId: string, expectedActiveVersionId: string | null) {
  const { data } = await apiClient.delete<ApiResponse<Document>>(`/documents/${documentId}`,
    { data: { expectedActiveVersionId } })
  return data.data
}
