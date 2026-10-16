import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import type {
  ApproveApprovedAnswerInput,
  ApprovedAnswerReviewQueueQuery,
  ArchiveApprovedAnswerInput,
  EditApprovedAnswerInput,
  ListApprovedAnswersQuery,
  ReuseApprovedAnswerInput,
  SaveApprovedAnswerInput,
  SuggestApprovedAnswersQuery,
} from './approvedAnswers.schema'
import { approvedAnswersService } from './approvedAnswers.service'

const saveApprovedAnswer = asyncHandler(async (req: Request, res: Response) => {
  const answer = await approvedAnswersService.saveApprovedAnswer(req.body as SaveApprovedAnswerInput, {
    organizationId: req.user.organizationId,
    userId: req.user.id,
  })
  res.status(201).json(ApiResponse.created('Approved answer saved', answer))
})

const listApprovedAnswers = asyncHandler(async (req: Request, res: Response) => {
  const result = await approvedAnswersService.listApprovedAnswers(
    req.query as ListApprovedAnswersQuery,
    req.user.organizationId,
  )
  res.status(200).json(ApiResponse.ok('Approved answers fetched', result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
    hasNextPage: result.hasNextPage,
    hasPrevPage: result.hasPrevPage,
  }))
})

const getApprovedAnswer = asyncHandler(async (req: Request, res: Response) => {
  const answer = await approvedAnswersService.getApprovedAnswerById(
    req.params.id as string,
    req.user.organizationId,
  )
  res.status(200).json(ApiResponse.ok('Approved answer fetched', answer))
})

const editApprovedAnswer = asyncHandler(async (req: Request, res: Response) => {
  const answer = await approvedAnswersService.editApprovedAnswer(
    req.params.id as string,
    req.body as EditApprovedAnswerInput,
    { organizationId: req.user.organizationId, userId: req.user.id },
  )
  res.status(200).json(ApiResponse.ok('Approved answer revision saved', answer))
})

const approveApprovedAnswer = asyncHandler(async (req: Request, res: Response) => {
  const answer = await approvedAnswersService.approveApprovedAnswer(
    req.params.id as string,
    req.body as ApproveApprovedAnswerInput,
    { organizationId: req.user.organizationId, userId: req.user.id },
  )
  res.status(200).json(ApiResponse.ok('Approved answer revision approved', answer))
})

const archiveApprovedAnswer = asyncHandler(async (req: Request, res: Response) => {
  const answer = await approvedAnswersService.archiveApprovedAnswer(
    req.params.id as string,
    req.body as ArchiveApprovedAnswerInput,
    req.user.organizationId,
  )
  res.status(200).json(ApiResponse.ok('Approved answer archived', answer))
})

const suggestApprovedAnswers = asyncHandler(async (req: Request, res: Response) => {
  const suggestions = await approvedAnswersService.suggestApprovedAnswers(
    req.query as unknown as SuggestApprovedAnswersQuery,
    req.user.organizationId,
  )
  res.status(200).json(ApiResponse.ok('Approved answer suggestions fetched', suggestions))
})

const reuseApprovedAnswer = asyncHandler(async (req: Request, res: Response) => {
  const draft = await approvedAnswersService.reuseApprovedAnswer(
    req.params.id as string,
    req.body as ReuseApprovedAnswerInput,
    { organizationId: req.user.organizationId, userId: req.user.id },
  )
  res.status(201).json(ApiResponse.created('Unapproved draft created from approved answer', draft))
})

const listApprovedAnswerReviewQueue = asyncHandler(async (req: Request, res: Response) => {
  const result = await approvedAnswersService.listApprovedAnswerReviewQueue(
    req.query as ApprovedAnswerReviewQueueQuery,
    req.user.organizationId,
  )
  res.status(200).json(ApiResponse.ok('Approved answer review queue fetched', result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: result.totalPages,
    hasNextPage: result.hasNextPage,
    hasPrevPage: result.hasPrevPage,
  }))
})

export const approvedAnswersController = {
  saveApprovedAnswer,
  listApprovedAnswers,
  getApprovedAnswer,
  editApprovedAnswer,
  approveApprovedAnswer,
  archiveApprovedAnswer,
  suggestApprovedAnswers,
  reuseApprovedAnswer,
  listApprovedAnswerReviewQueue,
}
