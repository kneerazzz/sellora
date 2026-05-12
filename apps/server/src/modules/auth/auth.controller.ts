import { Request, Response } from 'express'
import { authService } from './auth.service'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { ApiError } from '../../utils/apiError'
import type {
  RegisterInput,
  LoginInput,
  AcceptInviteInput,
} from './auth.schema'

// ── Cookie config ─────────────────────────────────────────────────────────────

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/api/v1/auth',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMeta(req: Request) {
  return {
    ipAddress:
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ??
      req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  }
}

function extractRefreshToken(req: Request): string {
  const fromCookie = req.cookies?.refreshToken as string | undefined
  const fromBody = req.body?.refreshToken as string | undefined
  const token = fromCookie ?? fromBody
  if (!token) throw ApiError.badRequest('Refresh token is required')
  return token
}

// ── Controllers ───────────────────────────────────────────────────────────────

const register = asyncHandler(async (req: Request, res: Response) => {
  const { user, tokens } = await authService.register(
    req.body as RegisterInput,
    extractMeta(req)
  )
  res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS)
  res.status(201).json(
    ApiResponse.created('Account created successfully', {
      user,
      accessToken: tokens.accessToken,
    })
  )
})

const login = asyncHandler(async (req: Request, res: Response) => {
  const { user, tokens } = await authService.login(
    req.body as LoginInput,
    extractMeta(req)
  )
  res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS)
  res.status(200).json(
    ApiResponse.ok('Login successful', { user, accessToken: tokens.accessToken })
  )
})

const refresh = asyncHandler(async (req: Request, res: Response) => {
  const { user, tokens } = await authService.refresh(
    extractRefreshToken(req),
    extractMeta(req)
  )
  res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS)
  res.status(200).json(
    ApiResponse.ok('Token refreshed', { user, accessToken: tokens.accessToken })
  )
})

const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(extractRefreshToken(req))
  res.clearCookie('refreshToken', { path: '/api/v1/auth' })
  res.status(200).json(ApiResponse.ok('Logged out successfully', null))
})

/**
 * POST /auth/logout-all
 * Revokes every active session for the current user.
 * Useful for "sign out of all devices" feature.
 */
const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  const { revokedCount } = await authService.logoutAll(req.user.id)
  res.clearCookie('refreshToken', { path: '/api/v1/auth' })
  res.status(200).json(
    ApiResponse.ok(`Signed out of ${revokedCount} device(s)`, { revokedCount })
  )
})

/**
 * GET /auth/sessions
 * Returns all active sessions (non-revoked, non-expired refresh tokens).
 * Each session shows device info, IP, and when it was created.
 */
const getSessions = asyncHandler(async (req: Request, res: Response) => {
  const sessions = await authService.getSessions(req.user.id)
  res.status(200).json(ApiResponse.ok('Active sessions fetched', sessions))
})

/**
 * DELETE /auth/sessions/:id
 * Revokes a specific session by its RefreshToken ID.
 * Ownership is verified in the service — users can only revoke their own sessions.
 */
const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params
  if (typeof id !== 'string') {
    throw ApiError.badRequest('Invalid session ID format') 
  }
  
  await authService.revokeSession(req.user.id, id)
  res.status(200).json(ApiResponse.ok('Session revoked successfully', null))
})

/**
 * POST /auth/accept-invite
 * Public endpoint — invited user sets their name + password and joins the org.
 * The invite token (from the email link) carries the email and role.
 */
const acceptInvite = asyncHandler(async (req: Request, res: Response) => {
  const { user, tokens } = await authService.acceptInvite(
    req.body as AcceptInviteInput,
    extractMeta(req)
  )
  res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS)
  res.status(201).json(
    ApiResponse.created('Account created. Welcome to your team!', {
      user,
      accessToken: tokens.accessToken,
    })
  )
})

export const authController = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getSessions,
  revokeSession,
  acceptInvite,
}