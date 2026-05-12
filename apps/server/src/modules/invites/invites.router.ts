import { Router } from "express";
import { invitesController } from "./invites.controller";
import { inviteIdParamSchema, inviteTokenParamSchema, listInvitesSchema, createInviteSchema } from "./invites.schema";
import { validate } from "@/middleware/validate.middleware";
import { authenticate } from "@/middleware/auth.middleware";
export const invitesRouter = Router()

invitesRouter.post(
  '/',
  authenticate,
  validate(createInviteSchema),
  invitesController.createInvite
)

invitesRouter.get(
  '/',
  authenticate,
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
  validate(inviteIdParamSchema),
  invitesController.revokeInvite
) 

invitesRouter.post(
  '/:id/resend',
  authenticate,
  validate(inviteIdParamSchema),
  invitesController.resendInvite
)


