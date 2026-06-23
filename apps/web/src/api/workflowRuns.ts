import { apiClient } from './client'
import type { ApiResponse, IntegrationProvider, SyncLogPreview, WorkflowRun } from '@/types/api'

export async function listWorkflowRuns(params?: {
  page?: number
  limit?: number
  status?: string
  type?: string
}) {
  const { data } = await apiClient.get<ApiResponse<WorkflowRun[]>>('/workflow-runs', { params })
  return { items: data.data, meta: data.meta }
}

export async function getWorkflowRun(id: string) {
  const { data } = await apiClient.get<ApiResponse<WorkflowRun>>(`/workflow-runs/${id}`)
  return data.data
}

export async function previewCrmWriteback(payload: {
  workflowRunId: string
  provider: IntegrationProvider
  externalObjectId?: string
  externalObjectType?: string
  integrationId?: string
}) {
  const { data } = await apiClient.post<ApiResponse<SyncLogPreview>>(
    '/crm-writeback/preview',
    payload
  )
  return data.data
}
