import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { documentsService } from './documents.service'
import type {
  CreateDocumentInput,
  IngestDocumentTextInput,
  ListDocumentsQuery,
  UploadDocumentInput,
} from './documents.schema'

const createDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await documentsService.createDocument(req.body as CreateDocumentInput, {
    organizationId: req.user.organizationId,
    userId: req.user.id,
  })

  res.status(201).json(ApiResponse.created('Document created', document))
})

const listDocuments = asyncHandler(async (req: Request, res: Response) => {
  const result = await documentsService.listDocuments(
    req.query as ListDocumentsQuery,
    req.user.organizationId
  )

  res.status(200).json(
    ApiResponse.ok('Documents fetched', result.items, {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages,
      hasNextPage: result.hasNextPage,
      hasPrevPage: result.hasPrevPage,
    })
  )
})

const uploadDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await documentsService.uploadDocument(req.body as UploadDocumentInput, {
    organizationId: req.user.organizationId,
    userId: req.user.id,
  })

  res.status(201).json(ApiResponse.created('Document uploaded and ingested', document))
})

const getDocumentById = asyncHandler(async (req: Request, res: Response) => {
  const document = await documentsService.getDocumentById(
    req.params.id as string,
    req.user.organizationId
  )

  res.status(200).json(ApiResponse.ok('Document fetched', document))
})

const ingestDocumentText = asyncHandler(async (req: Request, res: Response) => {
  const document = await documentsService.ingestDocumentText(
    req.params.id as string,
    req.body as IngestDocumentTextInput,
    req.user.organizationId
  )

  res.status(200).json(ApiResponse.ok('Document ingested', document))
})

export const documentsController = {
  createDocument,
  uploadDocument,
  listDocuments,
  getDocumentById,
  ingestDocumentText,
}
