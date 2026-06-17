import { Router } from "express";
import { invitesController } from "./invites.controller";
import { inviteIdParamSchema, inviteTokenParamSchema, listInvitesSchema, createInviteSchema } from "./invites.schema";
import { validate } from "../../middleware/validate.middleware";
import { authenticate, authorize } from "../../middleware/auth.middleware";

export const invitesRouter = Router()

invitesRouter.post(
  '/',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  validate(createInviteSchema),
  invitesController.createInvite
)

invitesRouter.get(
  '/',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  validate(listInvitesSchema),
  invitesController.listInvites
)

invitesRouter.get(
  '/validate/:token',
  validate(inviteTokenParamSchema),
  invitesController.validateInviteToken
)

invitesRouter.delete(
  '/:id',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  validate(inviteIdParamSchema),
  invitesController.revokeInvite
) 

invitesRouter.post(
  '/:id/resend',
  authenticate,
  authorize('ADMIN', 'MANAGER'),
  validate(inviteIdParamSchema),
  invitesController.resendInvite
)
