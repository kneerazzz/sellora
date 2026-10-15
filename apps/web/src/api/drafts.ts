import { apiClient } from './client'
import type { ApiResponse } from '@/types/api'

export interface DraftRevisionExport {
  exportId: string
  requestedAt: string
  draftId: string
  revisionId: string
  revisionNumber: number
  approvalStatus: 'APPROVED' | 'UNAPPROVED'
  sourceStatus: 'NO_SOURCES' | 'CURRENT' | 'STALE' | 'UNAVAILABLE'
  archived: boolean
  isRefusal: boolean
  content: string
  text: string
}

export async function approveDraftRevision(draftId: string, revisionId: string, note?: string) {
  const { data } = await apiClient.post<ApiResponse<Record<string, unknown>>>(
    `/drafts/${draftId}/approvals`, { revisionId, ...(note !== undefined && { note }) }
  )
  return data.data
}

export async function requestDraftRevisionExport(input: {
  draftId: string
  revisionId: string
  includeSources?: boolean
  approvedOnly?: boolean
}) {
  const { data } = await apiClient.post<ApiResponse<DraftRevisionExport>>(
    `/drafts/${input.draftId}/exports`, {
      revisionId: input.revisionId,
      includeSources: input.includeSources ?? false,
      approvedOnly: input.approvedOnly ?? false,
    }
  )
  return data.data
}

/** Call only after navigator.clipboard.writeText resolves successfully. */
export async function confirmDraftRevisionCopied(draftId: string, exportId: string) {
  const { data } = await apiClient.post<ApiResponse<{ id: string; createdAt: string }>>(
    `/drafts/${draftId}/exports/${exportId}/copied`, {}
  )
  return data.data
}
