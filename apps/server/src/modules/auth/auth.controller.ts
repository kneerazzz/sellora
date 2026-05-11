import { Request, Response } from 'express'
import { authService } from './auth.service'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { ApiError } from '../../utils/apiError'
import type { RegisterInput, LoginInput } from './auth.schema'

// ── Cookie config ─────────────────────────────────────────────────────────────

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,                              // not accessible via JS
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,            // 7 days in ms
  path: '/api/v1/auth',                        // only sent on auth routes
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMeta(req: Request) {
  return {
    ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
      ?? req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
  }
}

function extractRefreshToken(req: Request): string {
  // Accept from cookie first, fall back to body (for mobile clients)
  const fromCookie = req.cookies?.refreshToken as string | undefined
  const fromBody = req.body?.refreshToken as string | undefined
  const token = fromCookie ?? fromBody
  if (!token) throw ApiError.badRequest('Refresh token is required')
  return token
}

// ── Controllers ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/register
 * Creates a new Organization + Admin user.
 */
const register = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as RegisterInput
  const meta = extractMeta(req)

  const { user, tokens } = await authService.register(input, meta)

  res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS)

  res.status(201).json(
    ApiResponse.created('Account created successfully', {
      user,
      accessToken: tokens.accessToken,
    })
  )
})

/**
 * POST /api/v1/auth/login
 */
const login = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as LoginInput
  const meta = extractMeta(req)

  const { user, tokens } = await authService.login(input, meta)

  res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS)

  res.status(200).json(
    ApiResponse.ok('Login successful', {
      user,
      accessToken: tokens.accessToken,
    })
  )
})

/**
 * POST /api/v1/auth/refresh
 * Rotates the refresh token and issues a new access token.
 */
const refresh = asyncHandler(async (req: Request, res: Response) => {
  const rawToken = extractRefreshToken(req)
  const meta = extractMeta(req)

  const { user, tokens } = await authService.refresh(rawToken, meta)

  res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS)

  res.status(200).json(
    ApiResponse.ok('Token refreshed', {
      user,
      accessToken: tokens.accessToken,
    })
  )
})

/**
 * POST /api/v1/auth/logout
 */
const logout = asyncHandler(async (req: Request, res: Response) => {
  const rawToken = extractRefreshToken(req)

  await authService.logout(rawToken)

  res.clearCookie('refreshToken', { path: '/api/v1/auth' })

  res.status(200).json(ApiResponse.ok('Logged out successfully', null))
})

/**
 * GET /api/v1/auth/me
 * Returns the currently authenticated user's profile.
 */
const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getMe(req.user.id)
  res.status(200).json(ApiResponse.ok('User profile fetched', user))
})

export const authController = {
  register,
  login,
  refresh,
  logout,
  getMe,
}