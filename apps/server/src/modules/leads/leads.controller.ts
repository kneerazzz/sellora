import { Request, Response } from 'express'
import { leadsService } from './leads.service'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { ApiError } from '../../utils/apiError'
import type { CreateLeadInput, UpdateLeadInput, ListLeadsQuery } from './leads.schema'
import type { CallerContext } from './leads.service'

// Helper — builds CallerContext from req.user every time
function getCaller(req: Request): CallerContext {
  return {
    userId: req.user.id,
    organizationId: req.user.organizationId,
    role: req.user.role,
  }
}

const createLead = asyncHandler(async (req: Request, res: Response) => {
  const lead = await leadsService.createLead(
    req.body as CreateLeadInput,
    getCaller(req)
  )
  res.status(201).json(ApiResponse.created('Lead created', lead))
})

const listLeads = asyncHandler(async (req: Request, res: Response) => {
  const result = await leadsService.listLeads(
    req.query as unknown as ListLeadsQuery,
    getCaller(req)
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

const getLeadById = asyncHandler(async (req: Request, res: Response) => {
  if(typeof req.params.id !== 'string') throw ApiError.badRequest('Invalid lead ID format')
  const lead = await leadsService.getLeadById(req.params.id, getCaller(req))
  res.status(200).json(ApiResponse.ok('Lead fetched', lead))
})

const getLeadDetail = asyncHandler(async (req: Request, res: Response) => {
  if(typeof req.params.id !== 'string') throw ApiError.badRequest('Invalid lead ID format')
  const lead = await leadsService.getLeadDetail(req.params.id, getCaller(req))
  res.status(200).json(ApiResponse.ok('Lead detail fetched', lead))
})

const updateLead = asyncHandler(async (req: Request, res: Response) => {
  if(typeof req.params.id !== 'string') throw ApiError.badRequest('Invalid lead ID format')
  const lead = await leadsService.updateLead(
    req.params.id,
    req.body as UpdateLeadInput,
    getCaller(req)
  )
  res.status(200).json(ApiResponse.ok('Lead updated', lead))
})

const deleteLead = asyncHandler(async (req: Request, res: Response) => {
  if(typeof req.params.id !== 'string') throw ApiError.badRequest('Invalid lead ID format')
  await leadsService.deleteLead(req.params.id, getCaller(req))
  res.status(200).json(ApiResponse.noContent('Lead deleted'))
})

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

  const result = await leadsService.bulkAssign(leadIds, assignedToId, getCaller(req))
  res.status(200).json(ApiResponse.ok(`${result.updatedCount} leads assigned`, result))
})

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

  const result = await leadsService.bulkUpdateStatus(leadIds, status, getCaller(req))
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