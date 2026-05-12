import { Request, Response } from 'express'
import { leadsService } from './leads.service'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { ApiError } from '../../utils/apiError'
import type { CreateLeadInput, UpdateLeadInput, ListLeadsQuery } from './leads.schema'

/**
 * POST /api/v1/leads
 * Create a new lead scoped to the caller's org.
 */
const createLead = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadsService.createLead(req.body as CreateLeadInput, {
    userId: req.user.id,
    organizationId: req.user.organizationId,
  })

  res.status(201).json(ApiResponse.created('Lead created', lead))
})

/**
 * GET /api/v1/leads
 * List leads with pagination, search, and filters.
 */
const listLeads = asyncHandler(async (req: Request, res: Response) => {
  const result = await leadsService.listLeads(
    req.query as unknown as ListLeadsQuery,
    req.user.organizationId
  )

  res.status(200).json(
    ApiResponse.ok('Leads fetched', result.items, {
      page:        result.page,
      limit:       result.limit,
      total:       result.total,
      totalPages:  result.totalPages,
      hasNextPage: result.hasNextPage,
      hasPrevPage: result.hasPrevPage,
    })
  )
})

/**
 * GET /api/v1/leads/:id
 * Get a single lead — basic profile only.
 */
const getLeadById = asyncHandler(async (req: Request, res: Response) => {

  if(typeof req.params.id !== 'string') throw ApiError.badRequest('Invalid lead ID format')
  const lead = await leadsService.getLeadById(
    req.params.id,
    req.user.organizationId
  )

  res.status(200).json(ApiResponse.ok('Lead fetched', lead))
})

/**
 * GET /api/v1/leads/:id/detail
 * Get a lead with full activity timeline, deals, and tasks.
 * Used for the lead detail page in the frontend.
 */
const getLeadDetail = asyncHandler(async (req: Request, res: Response) => {
  if( typeof req.params.id !== 'string') throw ApiError.badRequest('Invalid lead ID format')
  const lead = await leadsService.getLeadDetail(
    req.params.id,
    req.user.organizationId
  )

  res.status(200).json(ApiResponse.ok('Lead detail fetched', lead))
})

/**
 * PATCH /api/v1/leads/:id
 * Partial update — only send the fields you want to change.
 */
const updateLead = asyncHandler(async (req: Request, res: Response) => {
  if( typeof req.params.id !== 'string') throw ApiError.badRequest('Invalid lead ID format')
  const lead = await leadsService.updateLead(
    req.params.id,
    req.body as UpdateLeadInput,
    req.user.organizationId
  )

  res.status(200).json(ApiResponse.ok('Lead updated', lead))
})

/**
 * DELETE /api/v1/leads/:id
 * Hard delete — Manager/Admin only (enforced in router).
 */
const deleteLead = asyncHandler(async (req: Request, res: Response) => {
  if( typeof req.params.id !== 'string') throw ApiError.badRequest('Invalid lead ID format')
  await leadsService.deleteLead(req.params.id, req.user.organizationId)
  res.status(200).json(ApiResponse.noContent('Lead deleted'))
})

/**
 * PATCH /api/v1/leads/bulk/assign
 * Assign multiple leads to a rep at once — Manager/Admin only.
 * Body: { leadIds: string[], assignedToId: string }
 */
const bulkAssign = asyncHandler(async (req: Request, res: Response) => {
  const { leadIds, assignedToId } = req.body

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    throw ApiError.badRequest('leadIds must be a non-empty array')
  }
  if (leadIds.length > 100) {
    throw ApiError.badRequest('Cannot bulk assign more than 100 leads at once')
  }
  if (!assignedToId) {
    throw ApiError.badRequest('assignedToId is required')
  }

  const result = await leadsService.bulkAssign(
    leadIds,
    assignedToId,
    req.user.organizationId
  )

  res.status(200).json(ApiResponse.ok(`${result.updatedCount} leads assigned`, result))
})

/**
 * PATCH /api/v1/leads/bulk/status
 * Update status for multiple leads at once — Manager/Admin only.
 * Body: { leadIds: string[], status: LeadStatus }
 */
const bulkUpdateStatus = asyncHandler(async (req: Request, res: Response) => {
  const { leadIds, status } = req.body

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    throw ApiError.badRequest('leadIds must be a non-empty array')
  }
  if (leadIds.length > 100) {
    throw ApiError.badRequest('Cannot bulk update more than 100 leads at once')
  }
  if (!status) {
    throw ApiError.badRequest('status is required')
  }

  const result = await leadsService.bulkUpdateStatus(
    leadIds,
    status,
    req.user.organizationId
  )

  res.status(200).json(
    ApiResponse.ok(`${result.updatedCount} leads updated to ${status}`, result)
  )
})

export const leadsController = {
  createLead,
  listLeads,
  getLeadById,
  getLeadDetail,
  updateLead,
  deleteLead,
  bulkAssign,
  bulkUpdateStatus,
}