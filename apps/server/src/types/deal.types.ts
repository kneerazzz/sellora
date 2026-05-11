import { DealStage } from '@prisma/client'
import { PaginationQuery } from './pagination.types'

export interface CreateDealInput {
  title: string
  leadId: string
  stage?: DealStage
  value?: number
  currency?: string
  probability?: number
  closeDate?: string
  description?: string
}

export interface UpdateDealInput extends Partial<CreateDealInput> {
  lostReason?: string
  competitorNotes?: string
}

export interface DealFilterQuery extends PaginationQuery {
  stage?: DealStage
  ownerId?: string
}