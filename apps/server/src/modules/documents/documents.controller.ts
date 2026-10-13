import { Request, Response } from 'express'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { documentsService } from './documents.service'
import type {
  CreateDocumentInput,
  IngestDocumentTextInput,
  ListDocumentsQuery,
  MultipartDocumentFieldsInput,
  UploadDocumentInput,
  ReplaceDocumentTextInput,
  ReplaceDocumentFileInput,
  DeleteDocumentInput,
  SourceReferencesInput,
} from './documents.schema'
import { randomUUID } from 'node:crypto'

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
    requestId: randomUUID(),
  })

  res.status(201).json(ApiResponse.created('Document uploaded and ingested', document))
})

const uploadMultipartDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await documentsService.uploadMultipartDocument(
    req.file,
    req.body as MultipartDocumentFieldsInput,
    {
      organizationId: req.user.organizationId,
      userId: req.user.id,
      requestId: randomUUID(),
    }
  )

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
    req.user.organizationId,
    { requestId: randomUUID() }
  )

  res.status(200).json(ApiResponse.ok('Document ingested', document))
})

const replaceDocumentText = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ReplaceDocumentTextInput
  const document = await documentsService.replaceDocumentText(req.params.id as string, input,
    req.user.organizationId, input.expectedActiveVersionId, { requestId: randomUUID() })
  res.status(200).json(ApiResponse.ok('Document replacement published', document))
})

const replaceDocumentFile = asyncHandler(async (req: Request, res: Response) => {
  const document = await documentsService.replaceMultipartDocument(req.params.id as string,
    req.file, req.body as ReplaceDocumentFileInput,
    { organizationId: req.user.organizationId, userId: req.user.id, requestId: randomUUID() })
  res.status(200).json(ApiResponse.ok('Document replacement published', document))
})

const listDocumentVersions = asyncHandler(async (req: Request, res: Response) => {
  const versions = await documentsService.listDocumentVersions(req.params.id as string, req.user.organizationId)
  res.status(200).json(ApiResponse.ok('Document versions fetched', versions))
})

const resolveSourceReferences = asyncHandler(async (req: Request, res: Response) => {
  const references = await documentsService.resolveSourceReferences(req.body as SourceReferencesInput,
    req.user.organizationId)
  res.status(200).json(ApiResponse.ok('Source references resolved', references))
})

const inspectDocumentVersion = asyncHandler(async (req: Request, res: Response) => {
  const result = await documentsService.inspectDocumentVersion(req.params.id as string,
    req.params.versionId as string, req.user.organizationId)
  res.status(200).json(ApiResponse.ok('Document source inspected', result))
})

const previewDocumentErasure = asyncHandler(async (req: Request, res: Response) => {
  const result = await documentsService.previewDocumentErasure(req.params.id as string,
    req.user.organizationId)
  res.status(200).json(ApiResponse.ok('Erasure dry run', result))
})

const retryDocumentVersion = asyncHandler(async (req: Request, res: Response) => {
  const document = await documentsService.retryDocumentVersion(req.params.id as string,
    req.params.versionId as string, req.user.organizationId, { requestId: randomUUID() })
  res.status(200).json(ApiResponse.ok('Document version published', document))
})

const deleteDocument = asyncHandler(async (req: Request, res: Response) => {
  const document = await documentsService.deleteDocument(req.params.id as string,
    req.user.organizationId, (req.body as DeleteDocumentInput).expectedActiveVersionId)
  res.status(200).json(ApiResponse.ok('Document deleted', document))
})

export const documentsController = {
  createDocument,
  uploadDocument,
  uploadMultipartDocument,
  listDocuments,
  getDocumentById,
  ingestDocumentText,
  replaceDocumentText,
  replaceDocumentFile,
  listDocumentVersions,
  resolveSourceReferences,
  inspectDocumentVersion,
  previewDocumentErasure,
  retryDocumentVersion,
  deleteDocument,
}
