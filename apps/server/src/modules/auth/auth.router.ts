import { resetPassword } from './accountLifecycle'
import { resetPasswordSchema } from './auth.schema'
import { asyncHandler } from '../../utils/asyncHandler'
import { ApiResponse } from '../../utils/apiResponse'
import { Router } from 'express'
import { accountAttemptLimit } from '../../middleware/accountAttemptLimit'
import { authController } from './auth.controller'
import { validate } from '../../middleware/validate.middleware'
import { authenticate } from '../../middleware/auth.middleware'
import { loginSchema, refreshSchema, registerSchema, acceptInviteSchema } from './auth.schema'

export const authRouter = Router()

// ── Public routes ─────────────────────────────────────────────────────────────

// POST /api/v1/auth/register
authRouter.post(
  '/register',
  accountAttemptLimit('register'),
  validate(registerSchema),
  authController.register
)

// POST /api/v1/auth/login
authRouter.post(
  '/login',
  accountAttemptLimit('login'),
  validate(loginSchema),
  authController.login
)

// POST /api/v1/auth/refresh
// Token can come from httpOnly cookie OR request body
authRouter.post(
  '/refresh',
  accountAttemptLimit('refresh'),
  validate(refreshSchema),
  authController.refresh
)

// POST /api/v1/auth/logout
authRouter.post(
  '/logout',
  accountAttemptLimit('logout'),
  authController.logout
)

// ── Protected routes ──────────────────────────────────────────────────────────


authRouter.post(
    '/logout-all',
    authenticate,
    authController.logoutAll
)

authRouter.get(
    '/sessions',
    authenticate,
    authController.getSessions
)

authRouter.delete(
    '/sessions/:id',
    authenticate,
    authController.revokeSession
)

authRouter.post(
    '/accept-invite',
  accountAttemptLimit('accept-invite'),
    validate(acceptInviteSchema),
    authController.acceptInvite
)
// Admin-delivered recovery capability; no public email enumeration endpoint.
authRouter.post('/reset-password', accountAttemptLimit('reset-password'),
  validate(resetPasswordSchema), asyncHandler(async (req, res) => {
    await resetPassword(req.body.token, req.body.password)
    res.status(200).json(ApiResponse.ok('Password reset. Sign in again.', null))
  }))
