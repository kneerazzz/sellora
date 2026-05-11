export interface IngestJobPayload {
  documentId: string
  organizationId: string
  storagePath: string
  fileType: 'PDF' | 'DOCX' | 'TXT' | 'MARKDOWN'
}

export interface WorkflowJobPayload {
  triggerId: string
  organizationId: string
  eventType: string
  eventData: Record<string, unknown>
}