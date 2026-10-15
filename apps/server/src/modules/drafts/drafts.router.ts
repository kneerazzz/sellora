import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { draftsController } from './drafts.controller'
import {
  appendDraftRevisionSchema,
  approveDraftSchema,
  archiveDraftSchema,
  confirmDraftCopySchema,
  createDraftSchema,
  draftDetailSchema,
  listDraftsSchema,
  requestDraftExportSchema,
} from './drafts.schema'

export const draftsRouter = Router()

draftsRouter.use(authenticate, authorize('ADMIN', 'MANAGER', 'REP'))
draftsRouter.get('/', validate(listDraftsSchema), draftsController.listDrafts)
draftsRouter.post('/', validate(createDraftSchema), draftsController.createDraft)
draftsRouter.get('/:id', validate(draftDetailSchema), draftsController.getDraft)
draftsRouter.post('/:id/revisions', validate(appendDraftRevisionSchema), draftsController.appendRevision)
draftsRouter.post('/:id/approvals', authorize('ADMIN', 'MANAGER'), validate(approveDraftSchema), draftsController.approveDraft)
draftsRouter.post('/:id/exports', validate(requestDraftExportSchema), draftsController.requestDraftExport)
draftsRouter.post('/:id/exports/:exportId/copied', validate(confirmDraftCopySchema), draftsController.confirmDraftCopy)
draftsRouter.delete('/:id', validate(archiveDraftSchema), draftsController.archiveDraft)
