import { apiClient } from './client'
import type { ApiKey, ApiResponse } from '@/types/api'

export async function listApiKeys(params?: { page?: number; limit?: number; isActive?: boolean }) {
  const { data } = await apiClient.get<ApiResponse<ApiKey[]>>('/api-keys', {
    params: {
      ...params,
      ...(typeof params?.isActive === 'boolean' ? { isActive: String(params.isActive) } : {}),
    },
  })
  return { items: data.data, meta: data.meta }
}

export async function createApiKey(payload: {
  label: string
  scope?: 'WEBHOOK_ONLY' | 'READ_ONLY' | 'FULL_ACCESS'
  expiresAt?: string
}) {
  const { data } = await apiClient.post<ApiResponse<{ apiKey: ApiKey; rawKey: string }>>(
    '/api-keys',
    payload
  )
  return data.data
}

export async function revokeApiKey(id: string) {
  const { data } = await apiClient.delete<ApiResponse<ApiKey>>(`/api-keys/${id}`)
  return data.data
}
