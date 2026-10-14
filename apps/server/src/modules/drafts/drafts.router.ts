import { Router } from 'express'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import { draftsController } from './drafts.controller'
import {
  appendDraftRevisionSchema,
  archiveDraftSchema,
  createDraftSchema,
  draftDetailSchema,
  listDraftsSchema,
} from './drafts.schema'

export const draftsRouter = Router()

draftsRouter.use(authenticate, authorize('ADMIN', 'MANAGER', 'REP'))
draftsRouter.get('/', validate(listDraftsSchema), draftsController.listDrafts)
draftsRouter.post('/', validate(createDraftSchema), draftsController.createDraft)
draftsRouter.get('/:id', validate(draftDetailSchema), draftsController.getDraft)
draftsRouter.post('/:id/revisions', validate(appendDraftRevisionSchema), draftsController.appendRevision)
draftsRouter.delete('/:id', validate(archiveDraftSchema), draftsController.archiveDraft)
