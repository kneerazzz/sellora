import { z } from 'zod'
import { authorize } from '../../middleware/auth.middleware'
import { issueRecovery, deactivateUser } from '../auth/accountLifecycle'
import { asyncHandler } from '../../utils/asyncHandler'
import { ApiResponse } from '../../utils/apiResponse'
import { accountAttemptLimit } from '../../middleware/accountAttemptLimit'
import { Router } from "express";
import { userController } from "./users.controller";
import { validate } from "@/middleware/validate.middleware";
import { changePasswordSchema, listUsersSchema, updateProfileSchema } from "./users.schema";
import { authenticate } from "@/middleware/auth.middleware";

export const usersRouter = Router()

// GET /api/v1/users — all members can view the team roster
usersRouter.get(
  '/',
  authenticate,
  validate(listUsersSchema),
  userController.listUsers
)

// GET /api/v1/users/me
usersRouter.get(
    '/me',
    authenticate,
    userController.getMe
)

// PATCH /api/v1/users/change-password

usersRouter.patch(
    '/change-password',
    accountAttemptLimit('change-password'),
    authenticate,
    validate(changePasswordSchema),
    userController.changePassword
)

// PATCH /api/v1/users/profile

usersRouter.patch(
    '/profile',
    authenticate,
    validate(updateProfileSchema),
    userController.updateProfile
)

const staffTargetSchema = z.object({ params: z.object({ id: z.string().cuid() }) })
usersRouter.post('/:id/recovery', authenticate, authorize('ADMIN'), accountAttemptLimit('issue-recovery'),
  validate(staffTargetSchema), asyncHandler(async (req, res) => {
    const result = await issueRecovery(req.user.organizationId, req.params.id as string)
    res.status(201).json(ApiResponse.created('Recovery capability created for secure delivery', result))
  }))
usersRouter.post('/:id/deactivate', authenticate, authorize('ADMIN'), accountAttemptLimit('deactivate'),
  validate(staffTargetSchema), asyncHandler(async (req, res) => {
    const result = await deactivateUser(req.user.organizationId, req.params.id as string, req.user.id)
    res.status(200).json(ApiResponse.ok('Staff access revoked; rotate organization integration keys', result))
  }))
