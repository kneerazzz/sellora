import { Router } from 'express'
import { leadsController } from './leads.controller'
import { authenticate, authorize } from '../../middleware/auth.middleware'
import { validate } from '../../middleware/validate.middleware'
import {
  createLeadSchema,
  updateLeadSchema,
  listLeadsSchema,
  leadParamSchema,
} from './leads.schema'

export const leadsRouter = Router()

// All leads routes require authentication
leadsRouter.use(authenticate)

// ── Bulk operations (must be defined BEFORE /:id routes) ─────────────────────
// Express matches routes in order — if /:id is first, "bulk" gets
// treated as an ID and fails the cuid validation.

leadsRouter.patch(
  '/bulk/assign',
  authorize('ADMIN', 'MANAGER'),
  leadsController.bulkAssign
)

leadsRouter.patch(
  '/bulk/status',
  authorize('ADMIN', 'MANAGER'),
  leadsController.bulkUpdateStatus
)

// ── Collection routes ─────────────────────────────────────────────────────────

leadsRouter.get(
  '/',
  validate(listLeadsSchema),
  leadsController.listLeads
)

leadsRouter.post(
  '/',
  validate(createLeadSchema),
  leadsController.createLead
)

// ── Single lead routes ────────────────────────────────────────────────────────

leadsRouter.get(
  '/:id',
  validate(leadParamSchema),
  leadsController.getLeadById
)

// Full detail view — includes activities, deals, tasks
leadsRouter.get(
  '/:id/detail',
  validate(leadParamSchema),
  leadsController.getLeadDetail
)

leadsRouter.patch(
  '/:id',
  validate(updateLeadSchema),
  leadsController.updateLead
)

leadsRouter.delete(
  '/:id',
  authorize('ADMIN', 'MANAGER'), // REPs cannot delete leads
  validate(leadParamSchema),
  leadsController.deleteLead
)