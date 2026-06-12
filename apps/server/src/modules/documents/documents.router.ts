import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { documentsController } from './documents.controller'
import {
  createDocumentSchema,
  documentIdParamSchema,
  ingestDocumentTextSchema,
  listDocumentsSchema,
  uploadDocumentSchema,
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
