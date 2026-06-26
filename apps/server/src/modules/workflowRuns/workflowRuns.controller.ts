import { Request, Response } from 'express'
import { UserRole } from '@prisma/client'
import { ApiResponse } from '../../utils/apiResponse'
import { ApiError } from '../../utils/apiError'
import { asyncHandler } from '../../utils/asyncHandler'
import { workflowRunsService } from './workflowRuns.service'
import type {
  ListWorkflowRunsQuery,
  ProcessQueuedWorkflowRunsInput,
} from './workflowRuns.schema'

const workflowProcessorRoles: UserRole[] = ['ADMIN', 'MANAGER', 'REP']

function getRequestOrganizationId(req: Request): string {
  const organizationId = req.user?.organizationId ?? req.apiKey?.organizationId

  if (!organizationId) {
    throw ApiError.unauthorized('Not authenticated')
  }

  return organizationId
}

function assertHumanWorkflowProcessor(req: Request) {
  if (!req.user) {
    return
  }

  if (!workflowProcessorRoles.includes(req.user.role)) {
    throw ApiError.forbidden(
      `This action requires one of the following roles: ${workflowProcessorRoles.join(', ')}`
    )
  }
}

const listWorkflowRuns = asyncHandler(async (req: Request, res: Response) => {
  const result = await workflowRunsService.listWorkflowRuns(
    req.query as ListWorkflowRunsQuery,
    getRequestOrganizationId(req)
  )

  res.status(200).json(
    ApiResponse.ok('Workflow runs fetched', result.items, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
      hasNextPage: result.hasNextPage,
      hasPrevPage: result.hasPrevPage,
    })
  )
})

const getWorkflowRunById = asyncHandler(async (req: Request, res: Response) => {
  const workflowRun = await workflowRunsService.getWorkflowRunById(
    req.params.id as string,
    getRequestOrganizationId(req)
  )

  res.status(200).json(ApiResponse.ok('Workflow run fetched', workflowRun))
})

const processWorkflowRun = asyncHandler(async (req: Request, res: Response) => {
  assertHumanWorkflowProcessor(req)

  const workflowRun = await workflowRunsService.processWorkflowRun({
    workflowRunId: req.params.id as string,
    organizationId: getRequestOrganizationId(req),
    userId: req.user?.id,
  })

  res.status(200).json(ApiResponse.ok('Workflow run processed', workflowRun))
})

const processNextQueuedWorkflowRun = asyncHandler(async (req: Request, res: Response) => {
  const workflowRun = await workflowRunsService.processNextQueuedWorkflowRun({
    organizationId: getRequestOrganizationId(req),
    userId: req.user.id,
  })

  res.status(200).json(ApiResponse.ok('Next queued workflow run processed', workflowRun))
})

const processQueuedWorkflowRuns = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ProcessQueuedWorkflowRunsInput
  const workflowRuns = await workflowRunsService.processQueuedWorkflowRuns({
    organizationId: getRequestOrganizationId(req),
    userId: req.user.id,
    limit: input.limit,
  })

  res.status(200).json(ApiResponse.ok('Queued workflow runs processed', workflowRuns))
})

export const workflowRunsController = {
  listWorkflowRuns,
  getWorkflowRunById,
  processWorkflowRun,
  processNextQueuedWorkflowRun,
  processQueuedWorkflowRuns,
}
