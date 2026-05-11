import { LeadStatus, LeadSource } from '@prisma/client'
import { PaginationQuery } from './pagination.types'

export interface CreateLeadInput {
  firstName: string
  lastName: string
  email?: string
  phone?: string
  company?: string
  jobTitle?: string
  source?: LeadSource
  tags?: string[]
  notes?: string
  assignedToId?: string
}

export interface UpdateLeadInput extends Partial<CreateLeadInput> {
  status?: LeadStatus
  nextFollowUpAt?: string
  customFields?: Record<string, unknown>
}

export interface LeadFilterQuery extends PaginationQuery {
  status?: LeadStatus
  source?: LeadSource
  assignedToId?: string
  tags?: string[]
}