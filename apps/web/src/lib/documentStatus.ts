import type { DocumentStatus } from '@/types/api'

export type DocumentUiStatus = 'pending' | 'chunked' | 'embedded' | 'failed'

export function mapDocumentStatus(status: DocumentStatus): DocumentUiStatus {
  switch (status) {
    case 'PENDING':
    case 'QUEUED':
      return 'pending'
    case 'PROCESSING':
      return 'chunked'
    case 'COMPLETED':
      return 'embedded'
    case 'FAILED':
      return 'failed'
    default:
      return 'pending'
  }
}

export const documentStatusLabel: Record<DocumentUiStatus, string> = {
  pending: 'Pending',
  chunked: 'Chunked',
  embedded: 'Embedded',
  failed: 'Failed',
}

export const documentStatusStyles: Record<DocumentUiStatus, string> = {
  pending: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  chunked: 'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  embedded: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  failed: 'bg-red-500/15 text-red-300 ring-red-500/30',
}
