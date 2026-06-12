import { Prisma, UserRole } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { buildPaginatedResult, getPaginationParams } from '../../utils/pagination'
import type { CreateLeadInput, UpdateLeadInput, ListLeadsQuery } from './leads.schema'
import type { PaginatedResult } from '../../types/pagination.types'

// ── Prisma select ─────────────────────────────────────────────────────────────

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

// ── Caller context — passed from controller via req.user ──────────────────────

export interface CallerContext {
  userId: string
  organizationId: string
  role: UserRole
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/**
 * Builds the base where clause for all lead queries.
 * REPs are automatically scoped to only their assigned leads.
 * ADMINs and MANAGERs see all leads in the org.
 */
function buildLeadScope(
  organizationId: string,
  caller: CallerContext
): Prisma.LeadWhereInput {
  return {
    organizationId,
    ...(caller.role === 'REP' && { assignedToId: caller.userId }),
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

async function createLead(
  input: CreateLeadInput,
  caller: CallerContext
): Promise<LeadPayload> {
  const { assignedToId, nextFollowUpAt, customFields, ...rest } = input

  // REPs can only create leads assigned to themselves
  if (caller.role === 'REP' && assignedToId && assignedToId !== caller.userId) {
    throw ApiError.forbidden('You can only create leads assigned to yourself')
  }

  if (assignedToId) {
    await validateAssignee(assignedToId, caller.organizationId)
  }

  const lead = await prisma.lead.create({
    data: {
      ...rest,
      nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt) : undefined,
      customFields: customFields as Prisma.InputJsonValue | undefined,
      organizationId: caller.organizationId,
      createdById: caller.userId,
      assignedToId: assignedToId ?? caller.userId,
    },
    select: leadSelect,
  })

  return lead
}

async function getLeadById(
  leadId: string,
  caller: CallerContext
): Promise<LeadPayload> {
  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      // scope: REP can only fetch their own leads
      ...buildLeadScope(caller.organizationId, caller),
    },
    select: leadSelect,
  })

  if (!lead) throw ApiError.notFound('Lead not found')
  return lead
}

async function getLeadDetail(leadId: string, caller: CallerContext) {
  const lead = await prisma.lead.findFirst({
    where: {
      id: leadId,
      // scope: REP can only fetch their own leads
      ...buildLeadScope(caller.organizationId, caller),
    },
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
        take: 50,
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

async function listLeads(
  query: ListLeadsQuery,
  caller: CallerContext
): Promise<PaginatedResult<LeadPayload>> {
  const { page, limit, skip } = getPaginationParams(query)
  const sortBy    = query.sortBy    ?? 'createdAt'
  const sortOrder = query.sortOrder ?? 'desc'

  const where: Prisma.LeadWhereInput = {
    // buildLeadScope handles REP scoping automatically
    ...buildLeadScope(caller.organizationId, caller),

    ...(query.status && { status: query.status }),
    ...(query.source && { source: query.source }),

    // ADMIN/MANAGER can filter by assignee; for REP this is already
    // locked to their own ID via buildLeadScope so this filter is ignored
    ...(caller.role !== 'REP' && query.assignedToId && {
      assignedToId: query.assignedToId,
    }),

    ...(query.tags?.length && { tags: { hasEvery: query.tags } }),

    ...(query.search && {
      OR: [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName:  { contains: query.search, mode: 'insensitive' } },
        { email:     { contains: query.search, mode: 'insensitive' } },
        { company:   { contains: query.search, mode: 'insensitive' } },
        { jobTitle:  { contains: query.search, mode: 'insensitive' } },
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

  return buildPaginatedResult({ items, total, page, limit })
}

async function updateLead(
  leadId: string,
  input: UpdateLeadInput,
  caller: CallerContext
): Promise<LeadPayload> {
  // Scope check: REP can only update their own leads
  const existing = await prisma.lead.findFirst({
    where: {
      id: leadId,
      ...buildLeadScope(caller.organizationId, caller),
    },
    select: { id: true, status: true },
  })
  if (!existing) throw ApiError.notFound('Lead not found')

  // REPs cannot reassign leads to someone else
  const { assignedToId, nextFollowUpAt, customFields, ...rest } = input

  if (caller.role === 'REP' && assignedToId && assignedToId !== caller.userId) {
    throw ApiError.forbidden('You cannot reassign a lead to another rep')
  }

  if (assignedToId) {
    await validateAssignee(assignedToId, caller.organizationId)
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

async function deleteLead(leadId: string, caller: CallerContext): Promise<void> {
  // ADMIN/MANAGER only — enforced at router level too, but double-check here
  if (caller.role === 'REP') {
    throw ApiError.forbidden('You do not have permission to delete leads')
  }

  const existing = await prisma.lead.findFirst({
    where: { id: leadId, organizationId: caller.organizationId },
    select: { id: true },
  })
  if (!existing) throw ApiError.notFound('Lead not found')

  await prisma.lead.delete({ where: { id: leadId } })
}

async function bulkAssign(
  leadIds: string[],
  assignedToId: string,
  caller: CallerContext
): Promise<{ updatedCount: number }> {
  await validateAssignee(assignedToId, caller.organizationId)

  const result = await prisma.lead.updateMany({
    where: {
      id: { in: leadIds },
      organizationId: caller.organizationId,
    },
    data: { assignedToId },
  })

  return { updatedCount: result.count }
}

async function bulkUpdateStatus(
  leadIds: string[],
  status: string,
  caller: CallerContext
): Promise<{ updatedCount: number }> {
  const result = await prisma.lead.updateMany({
    where: {
      id: { in: leadIds },
      organizationId: caller.organizationId,
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
