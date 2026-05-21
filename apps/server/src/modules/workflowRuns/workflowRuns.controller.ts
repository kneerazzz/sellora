import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { workflowRunsService } from './workflowRuns.service'
import type { ListWorkflowRunsQuery } from './workflowRuns.schema'

const listWorkflowRuns = asyncHandler(async (req: Request, res: Response) => {
  const result = await workflowRunsService.listWorkflowRuns(
    req.query as ListWorkflowRunsQuery,
    req.user.organizationId
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
    req.user.organizationId
  )

  res.status(200).json(ApiResponse.ok('Workflow run fetched', workflowRun))
})

const processWorkflowRun = asyncHandler(async (req: Request, res: Response) => {
  const workflowRun = await workflowRunsService.processWorkflowRun({
    workflowRunId: req.params.id as string,
    organizationId: req.user.organizationId,
    userId: req.user.id,
  })

  res.status(200).json(ApiResponse.ok('Workflow run processed', workflowRun))
})

export const workflowRunsController = {
  listWorkflowRuns,
  getWorkflowRunById,
  processWorkflowRun,
}
