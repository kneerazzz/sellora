import { DocumentType, DocumentStatus } from '@prisma/client'

export interface UploadDocumentInput {
  displayName: string
  description?: string
  tags?: string[]
}

export interface DocumentResponse {
  id: string
  filename: string
  displayName: string
  fileType: DocumentType
  status: DocumentStatus
  sizeBytes: number
  totalChunks: number | null
  ingestedAt: Date | null
  createdAt: Date
}