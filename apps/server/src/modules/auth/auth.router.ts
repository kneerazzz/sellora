import { Router } from 'express'
import { authController } from './auth.controller'
import { validate } from '../../middleware/validate.middleware'
import { authenticate } from '../../middleware/auth.middleware'
import { loginSchema, refreshSchema, registerSchema, acceptInviteSchema } from './auth.schema'

export const authRouter = Router()

// ── Public routes ─────────────────────────────────────────────────────────────

// POST /api/v1/auth/register
authRouter.post(
  '/register',
  validate(registerSchema),
  authController.register
)

// POST /api/v1/auth/login
authRouter.post(
  '/login',
  validate(loginSchema),
  authController.login
)

// POST /api/v1/auth/refresh
// Token can come from httpOnly cookie OR request body
authRouter.post(
  '/refresh',
  validate(refreshSchema),
  authController.refresh
)

// POST /api/v1/auth/logout
authRouter.post(
  '/logout',
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
    validate(acceptInviteSchema),
    authController.acceptInvite
)