export type UserRole = 'ADMIN' | 'MANAGER' | 'REP'

export interface Organization {
  id: string
  name: string
  slug: string
  plan: string
  logoUrl: string | null
}

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  organizationId: string
  avatarUrl?: string | null
  phone?: string | null
  title?: string | null
  timezone?: string
  isActive?: boolean
  emailVerified?: boolean
  createdAt?: string
  organization?: Organization
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface ApiResponse<T> {
  success: boolean
  statusCode: number
  message: string
  data: T
  meta?: PaginationMeta
}

export interface ApiErrorBody {
  success: false
  statusCode: number
  message: string
  errors: string[]
}

export type DocumentStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'

export type DocumentType = 'PDF' | 'DOCX' | 'TXT' | 'MARKDOWN'

export interface Document {
  id: string
  createdAt: string
  updatedAt: string
  filename: string
  displayName: string
  description: string | null
  mimeType: string
  sizeBytes: number
  fileType: DocumentType
  storagePath: string
  status: DocumentStatus
  errorMessage: string | null
  pageCount: number | null
  totalChunks: number | null
  embeddingModel: string | null
  ingestedAt: string | null
  tags: string[]
  organizationId: string
  uploadedById: string
}

export type ApiKeyScope = 'READ_ONLY' | 'FULL_ACCESS' | 'WEBHOOK_ONLY'

export interface ApiKey {
  id: string
  createdAt: string
  label: string
  keyPrefix: string
  scope: ApiKeyScope
  isActive: boolean
  expiresAt: string | null
  lastUsedAt: string | null
  usageCount: number
  organizationId: string
}

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED'

export interface Invite {
  id: string
  createdAt: string
  expiresAt: string
  email: string
  role: UserRole
  status: InviteStatus
  token: string
  organizationId: string
  organization?: Organization
}

export interface TeamMember {
  id: string
  createdAt: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  avatarUrl: string | null
  title: string | null
  isActive: boolean
  lastLoginAt: string | null
  organizationId: string
}

export type WorkflowRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'NEEDS_REVIEW'

export type WorkflowRunType =
  | 'SALES_EVENT_EXTRACTION'
  | 'GROUNDED_TECHNICAL_ANSWER'
  | 'CRM_UPDATE_PREPARATION'
  | 'EMAIL_DRAFT'
  | 'CALL_SUMMARY'
  | 'CUSTOM'

export interface WebhookEventSummary {
  id: string
  source: string
  eventType: string
  status: string
  externalObjectType: string | null
  externalObjectId: string | null
  receivedAt: string
  processedAt: string | null
  payload?: unknown
  errorMessage?: string | null
}

export interface WorkflowRun {
  id: string
  createdAt: string
  updatedAt: string
  type: WorkflowRunType
  status: WorkflowRunStatus
  confidence: string | null
  startedAt: string | null
  completedAt: string | null
  errorMessage: string | null
  organizationId: string
  webhookEventId: string | null
  input?: unknown
  output?: unknown
  webhookEvent?: WebhookEventSummary | null
}

export type IntegrationProvider =
  | 'SALESFORCE'
  | 'HUBSPOT'
  | 'GMAIL'
  | 'OUTLOOK'
  | 'SLACK'
  | 'RECALL_AI'
  | 'N8N'
  | 'CUSTOM'

export interface SyncLogPreview {
  id: string
  status: string
  direction: string
  provider: IntegrationProvider
  externalObjectType: string | null
  externalObjectId: string | null
  requestPayload: unknown
  workflowRunId: string | null
  webhookEventId: string | null
  integrationId: string | null
  createdAt: string
}

export interface InviteValidation {
  email: string
  role: string
  organizationName: string
  organizationLogoUrl: string | null
  expiresAt: string
}
