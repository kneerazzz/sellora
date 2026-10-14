import { randomUUID } from 'node:crypto'
import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { withClientDisconnectSignal } from '../../services/provider/httpCancellation'
import { draftsService } from './drafts.service'
import type {
  AppendDraftRevisionInput,
  ArchiveDraftInput,
  CreateDraftInput,
  ListDraftsQuery,
} from './drafts.schema'

const createDraft = asyncHandler(async (req: Request, res: Response) => {
  const draft = await withClientDisconnectSignal(res, signal => draftsService.createDraft(
    req.body as CreateDraftInput,
    {
      organizationId: req.user.organizationId,
      userId: req.user.id,
      requestId: randomUUID(),
      signal,
    }
  ))
  res.status(201).json(ApiResponse.created('Draft created', draft))
})

const listDrafts = asyncHandler(async (req: Request, res: Response) => {
  const result = await draftsService.listDrafts(req.query as ListDraftsQuery, req.user.organizationId)
  res.status(200).json(ApiResponse.ok('Drafts fetched', result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
    hasNextPage: result.hasNextPage,
    hasPrevPage: result.hasPrevPage,
  }))
})

const getDraft = asyncHandler(async (req: Request, res: Response) => {
  const draft = await draftsService.getDraftById(req.params.id as string, req.user.organizationId)
  res.status(200).json(ApiResponse.ok('Draft fetched', draft))
})

const appendRevision = asyncHandler(async (req: Request, res: Response) => {
  const draft = await draftsService.appendRevision(
    req.params.id as string,
    req.body as AppendDraftRevisionInput,
    { organizationId: req.user.organizationId, userId: req.user.id }
  )
  res.status(200).json(ApiResponse.ok('Draft revision saved', draft))
})

const archiveDraft = asyncHandler(async (req: Request, res: Response) => {
  const draft = await draftsService.archiveDraft(
    req.params.id as string,
    req.body as ArchiveDraftInput,
    req.user.organizationId
  )
  res.status(200).json(ApiResponse.ok('Draft archived', draft))
})

export const draftsController = { createDraft, listDrafts, getDraft, appendRevision, archiveDraft }
