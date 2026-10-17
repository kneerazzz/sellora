import { apiClient } from './client'
import type { ApiResponse, PaginationMeta } from '@/types/api'

export interface DraftSource {
  documentId: string
  versionId: string
  chunkId: string
  availability: 'CURRENT' | 'STALE' | 'UNAVAILABLE'
  displayName?: string
  filename?: string
  chunkIndex?: number
  pageNumber?: number | null
  headingPath?: string[]
  sectionTitle?: string | null
}

export interface DraftRevision {
  id: string
  createdAt: string
  revisionNumber: number
  content: string
  origin: 'GENERATED' | 'MANUAL'
  isRefusal: boolean
  author: { id: string; firstName: string; lastName: string } | null
  sources: DraftSource[]
}

export interface Draft {
  id: string
  createdAt: string
  updatedAt: string
  title: string | null
  question: string
  processingStatus: string
  reviewStatus: string
  deliveryStatus: string
  generationErrorCode: string | null
  currentRevisionId: string | null
  concurrencyToken: number
  archivedAt: string | null
  reusedApprovedAnswerId: string | null
  reusedApprovedAnswerRevisionId: string | null
  author: { id: string; firstName: string; lastName: string } | null
  currentRevision: Pick<DraftRevision, 'id' | 'revisionNumber' | 'content' | 'isRefusal' | 'createdAt'> | null
  revisions?: DraftRevision[]
  approvals?: Array<{ id: string; createdAt: string; decision: string; note: string | null; revisionId: string; reviewer: { id: string; firstName: string; lastName: string } }>
}

export async function listDrafts() {
  const { data } = await apiClient.get<ApiResponse<Draft[]> & { meta?: PaginationMeta }>('/drafts')
  return data.data
}

export async function getDraft(id: string) {
  const { data } = await apiClient.get<ApiResponse<Draft>>(`/drafts/${id}`)
  return data.data
}

export async function createDraft(input: { idempotencyKey: string; question: string }) {
  const { data } = await apiClient.post<ApiResponse<Draft>>('/drafts', input)
  return data.data
}

export async function saveDraftRevision(id: string, expectedRevisionId: string, content: string) {
  const { data } = await apiClient.post<ApiResponse<Draft>>(`/drafts/${id}/revisions`, { expectedRevisionId, content })
  return data.data
}

export async function saveDraftToLibrary(input: { draftId: string; revisionId: string; title: string }) {
  const { data } = await apiClient.post<ApiResponse<ApprovedAnswer>>('/approved-answers', { ...input, tags: [] })
  return data.data
}

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

export interface ApprovedAnswer {
  id: string
  title: string
  question: string
  tags: string[]
  reviewStatus: string
  currentRevisionId: string | null
  concurrencyToken: number
  archivedAt: string | null
  eligibility?: 'CURRENT' | 'STALE' | 'UNAVAILABLE' | 'REVIEW_REQUIRED'
  currentRevision: { id: string; revisionNumber: number; content: string; createdAt: string } | null
  revisions?: Array<{ id: string; revisionNumber: number; content: string; title: string; question: string; createdAt: string; sources: DraftSource[] }>
}

export async function listApprovedAnswers(search = '') {
  const { data } = await apiClient.get<ApiResponse<ApprovedAnswer[]>>('/approved-answers', { params: { search } })
  return data.data
}

export async function getApprovedAnswer(id: string) {
  const { data } = await apiClient.get<ApiResponse<ApprovedAnswer>>(`/approved-answers/${id}`)
  return data.data
}

export async function approveApprovedAnswer(id: string, revisionId: string) {
  const { data } = await apiClient.post<ApiResponse<ApprovedAnswer>>(`/approved-answers/${id}/approvals`, { revisionId })
  return data.data
}

export async function listApprovedAnswerReviewQueue() {
  const { data } = await apiClient.get<ApiResponse<Array<{ id: string; title: string; question: string; currentRevisionId: string | null; reviewStatus: string; reasons: Array<{ code: string }> }>>>('/approved-answers/review-queue')
  return data.data
}

export async function reuseApprovedAnswer(id: string, expectedRevisionId: string, question: string) {
  const { data } = await apiClient.post<ApiResponse<Draft>>(`/approved-answers/${id}/reuse`, {
    expectedRevisionId, idempotencyKey: crypto.randomUUID(), question,
  })
  return data.data
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
