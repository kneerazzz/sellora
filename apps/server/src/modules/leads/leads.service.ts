import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import type { CreateLeadInput, UpdateLeadInput, ListLeadsQuery } from './leads.schema'
import type { PaginatedResult } from '../../types/pagination.types'

// ── Prisma select — what we return for a lead ─────────────────────────────────
// Defined once here so every method returns the same shape.

const leadSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  linkedinUrl: true,
  avatarUrl: true,
  company: true,
  jobTitle: true,
  department: true,
  companySize: true,
  industry: true,
  website: true,
  country: true,
  city: true,
  status: true,
  source: true,
  tags: true,
  notes: true,
  aiScore: true,
  aiScoreReason: true,
  aiSummary: true,
  lastContactedAt: true,
  nextFollowUpAt: true,
  emailOpenCount: true,
  emailClickCount: true,
  customFields: true,
  organizationId: true,
  assignedTo: {
    select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true },
  },
  createdBy: {
    select: { id: true, firstName: true, lastName: true },
  },
  _count: {
    select: { deals: true, activities: true, tasks: true },
  },
} satisfies Prisma.LeadSelect

export type LeadPayload = Prisma.LeadGetPayload<{ select: typeof leadSelect }>

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Verify that an assignedToId belongs to the same org.
 * Prevents assigning leads to users in other organizations.
 */
async function validateAssignee(
  assignedToId: string,
  organizationId: string
): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: assignedToId, organizationId, isActive: true },
    select: { id: true },
  })
  if (!user) {
    throw ApiError.badRequest(
      'Assigned user does not exist or does not belong to your organization'
    )
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Create a new lead scoped to the caller's organization.
 */
async function createLead(
  input: CreateLeadInput,
  context: { userId: string; organizationId: string }
): Promise<LeadPayload> {
  const { assignedToId, nextFollowUpAt, customFields, ...rest } = input

  if (assignedToId) {
    await validateAssignee(assignedToId, context.organizationId)
  }

  const lead = await prisma.lead.create({
    data: {
      ...rest,
      nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : undefined,
      customFields: customFields as Prisma.InputJsonValue | undefined,
      organizationId: context.organizationId,
      createdById: context.userId,
      assignedToId: assignedToId ?? context.userId, // default assign to creator
    },
    select: leadSelect,
  })

  return lead
}

/**
 * Get a single lead by ID — scoped to org.
 */
async function getLeadById(
  leadId: string,
  organizationId: string
): Promise<LeadPayload> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: leadSelect,
  })

  if (!lead) throw ApiError.notFound('Lead not found')
  return lead
}

/**
 * Get a lead with its full activity timeline, deals, and tasks.
 * Used for the lead detail page.
 */
async function getLeadDetail(leadId: string, organizationId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: {
      ...leadSelect,
      deals: {
        select: {
          id: true,
          title: true,
          stage: true,
          value: true,
          currency: true,
          probability: true,
          closeDate: true,
          createdAt: true,
          owner: {
            select: { id: true, firstName: true, lastName: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      activities: {
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          metadata: true,
          isAutoLogged: true,
          createdAt: true,
          user: {
            select: { id: true, firstName: true, lastName: true, avatarUrl: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50, // last 50 activities
      },
      tasks: {
        select: {
          id: true,
          title: true,
          description: true,
          dueDate: true,
          status: true,
          priority: true,
          completedAt: true,
          assignedTo: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        where: { status: { not: 'CANCELLED' } },
        orderBy: { dueDate: 'asc' },
      },
    },
  })

  if (!lead) throw ApiError.notFound('Lead not found')
  return lead
}

/**
 * List leads with pagination, search, and filtering.
 */
async function listLeads(
  query: ListLeadsQuery,
  organizationId: string
): Promise<PaginatedResult<LeadPayload>> {
  const page     = query.page     ?? 1
  const limit    = query.limit    ?? 20
  const sortBy   = query.sortBy   ?? 'createdAt'
  const sortOrder = query.sortOrder ?? 'desc'
  const skip     = (page - 1) * limit

  // Build where clause
  const where: Prisma.LeadWhereInput = {
    organizationId,
    ...(query.status       && { status: query.status }),
    ...(query.source       && { source: query.source }),
    ...(query.assignedToId && { assignedToId: query.assignedToId }),
    // Tags: lead must have ALL provided tags
    ...(query.tags?.length && { tags: { hasEvery: query.tags } }),
    // Search: across name, email, company
    ...(query.search && {
      OR: [
        { firstName:  { contains: query.search, mode: 'insensitive' } },
        { lastName:   { contains: query.search, mode: 'insensitive' } },
        { email:      { contains: query.search, mode: 'insensitive' } },
        { company:    { contains: query.search, mode: 'insensitive' } },
        { jobTitle:   { contains: query.search, mode: 'insensitive' } },
      ],
    }),
  }

  const [items, total] = await prisma.$transaction([
    prisma.lead.findMany({
      where,
      select: leadSelect,
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limit,
    }),
    prisma.lead.count({ where }),
  ])

  const totalPages = Math.ceil(total / limit)

  return {
    items,
    total,
    page,
    limit,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  }
}

/**
 * Update a lead — partial update, only provided fields are changed.
 */
async function updateLead(
  leadId: string,
  input: UpdateLeadInput,
  organizationId: string
): Promise<LeadPayload> {
  // Verify lead exists and belongs to org
  const existing = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: { id: true, status: true },
  })
  if (!existing) throw ApiError.notFound('Lead not found')

  const { assignedToId, nextFollowUpAt, customFields, ...rest } = input

  if (assignedToId) {
    await validateAssignee(assignedToId, organizationId)
  }

  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: {
      ...rest,
      ...(assignedToId !== undefined && { assignedToId }),
      ...(nextFollowUpAt !== undefined && {
        nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : null,
      }),
      ...(customFields !== undefined && {
        customFields: customFields as Prisma.InputJsonValue,
      }),
    },
    select: leadSelect,
  })

  return lead
}

/**
 * Delete a lead — scoped to org.
 * Hard delete. Activities use onDelete: SetNull so history is preserved.
 */
async function deleteLead(leadId: string, organizationId: string): Promise<void> {
  const existing = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: { id: true },
  })
  if (!existing) throw ApiError.notFound('Lead not found')

  await prisma.lead.delete({ where: { id: leadId } })
}

/**
 * Bulk assign leads to a rep.
 * Manager/Admin only — enforced at the router level.
 */
async function bulkAssign(
  leadIds: string[],
  assignedToId: string,
  organizationId: string
): Promise<{ updatedCount: number }> {
  await validateAssignee(assignedToId, organizationId)

  const result = await prisma.lead.updateMany({
    where: {
      id: { in: leadIds },
      organizationId, // ensures you can only update leads in your org
    },
    data: { assignedToId },
  })

  return { updatedCount: result.count }
}

/**
 * Bulk update status for multiple leads.
 */
async function bulkUpdateStatus(
  leadIds: string[],
  status: string,
  organizationId: string
): Promise<{ updatedCount: number }> {
  const result = await prisma.lead.updateMany({
    where: {
      id: { in: leadIds },
      organizationId,
    },
    data: { status: status as any },
  })

  return { updatedCount: result.count }
}

export const leadsService = {
  createLead,
  getLeadById,
  getLeadDetail,
  listLeads,
  updateLead,
  deleteLead,
  bulkAssign,
  bulkUpdateStatus,
}