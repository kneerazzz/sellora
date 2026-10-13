import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { documentUpload } from '../../middleware/upload.middleware'
import { validate } from '../../middleware/validate.middleware'
import { documentsController } from './documents.controller'
import {
  createDocumentSchema,
  documentIdParamSchema,
  ingestDocumentTextSchema,
  listDocumentsSchema,
  multipartDocumentFieldsSchema,
  uploadDocumentSchema,
  replaceDocumentTextSchema,
  replaceDocumentFileSchema,
  deleteDocumentSchema,
  documentVersionParamSchema,
} from './documents.schema'

export const documentsRouter = Router()

documentsRouter.use(authenticate)

documentsRouter.get('/', validate(listDocumentsSchema), documentsController.listDocuments)

documentsRouter.post(
  '/',
  authorize('ADMIN', 'MANAGER'),
  validate(createDocumentSchema),
  documentsController.createDocument
)

documentsRouter.post(
  '/upload',
  authorize('ADMIN', 'MANAGER'),
  validate(uploadDocumentSchema),
  documentsController.uploadDocument
)

documentsRouter.post(
  '/upload-file',
  authorize('ADMIN', 'MANAGER'),
  documentUpload.single('file'),
  validate(multipartDocumentFieldsSchema),
  documentsController.uploadMultipartDocument
)

documentsRouter.get(
  '/:id',
  validate(documentIdParamSchema),
  documentsController.getDocumentById
)

documentsRouter.post(
  '/:id/ingest-text',
  authorize('ADMIN', 'MANAGER'),
  validate(ingestDocumentTextSchema),
  documentsController.ingestDocumentText
)

documentsRouter.get('/:id/versions', validate(documentIdParamSchema), documentsController.listDocumentVersions)
documentsRouter.post('/:id/replace-text', authorize('ADMIN', 'MANAGER'),
  validate(replaceDocumentTextSchema), documentsController.replaceDocumentText)
documentsRouter.post('/:id/replace-file', authorize('ADMIN', 'MANAGER'),
  documentUpload.single('file'), validate(replaceDocumentFileSchema), documentsController.replaceDocumentFile)
documentsRouter.post('/:id/versions/:versionId/retry', authorize('ADMIN', 'MANAGER'),
  validate(documentVersionParamSchema), documentsController.retryDocumentVersion)
documentsRouter.delete('/:id', authorize('ADMIN', 'MANAGER'),
  validate(deleteDocumentSchema), documentsController.deleteDocument)
