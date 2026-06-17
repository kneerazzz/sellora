import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { ApiError } from '../utils/apiError'
import { prisma } from '../config/prisma'
import { sha256Hex } from '../utils/crypto'
import type { JwtAccessPayload } from '../types/auth.types'
import { ApiKeyScope, UserRole } from '@prisma/client'
import { env } from '@/config/env'


function extractBearerToken(req: Request): string {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    throw ApiError.unauthorized('No token provided')
  }

  const token = authHeader.split(' ')[1]
  if (!token) {
    throw ApiError.unauthorized('No token provided')
  }

  return token
}

/**
 * Verifies the JWT access token from the Authorization header.
 * Attaches the decoded payload to req.user.
 *
 * Usage: add `authenticate` to any protected route.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearerToken(req)

    let payload: JwtAccessPayload
    try {
      payload = jwt.verify(
        token,
        env.JWT_ACCESS_SECRET as string
      ) as JwtAccessPayload
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw ApiError.unauthorized('Access token has expired')
      }
      throw ApiError.unauthorized('Invalid access token')
    }

    // Attach to request — downstream controllers use req.user
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      organizationId: payload.organizationId,
      firstName: '',
      lastName: '',
    }

    next()
  } catch (err) {
    next(err)
  }
}

/**
 * Verifies an org-scoped API key from the Authorization header.
 * Intended for n8n and external workflow callers, not browser sessions.
 *
 * Usage:
 *   router.post('/webhooks/email', authenticateApiKey('WEBHOOK_ONLY'), controller)
 */
export function authenticateApiKey(...allowedScopes: ApiKeyScope[]) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const rawKey = extractBearerToken(req)
      const keyHash = sha256Hex(rawKey)

      const apiKey = await prisma.apiKey.findUnique({
        where: { keyHash },
        select: {
          id: true,
          scope: true,
          isActive: true,
          expiresAt: true,
          organizationId: true,
        },
      })

      if (!apiKey || !apiKey.isActive) {
        throw ApiError.unauthorized('Invalid API key')
      }

      if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
        throw ApiError.unauthorized('API key has expired')
      }

      const hasAllowedScope =
        allowedScopes.length === 0 ||
        apiKey.scope === 'FULL_ACCESS' ||
        allowedScopes.includes(apiKey.scope)

      if (!hasAllowedScope) {
        throw ApiError.forbidden(
          `This API key requires one of the following scopes: ${allowedScopes.join(', ')}`
        )
      }

      req.apiKey = {
        id: apiKey.id,
        scope: apiKey.scope,
        organizationId: apiKey.organizationId,
      }

      prisma.apiKey
        .update({
          where: { id: apiKey.id },
          data: {
            lastUsedAt: new Date(),
            usageCount: { increment: 1 },
          },
        })
        .catch(() => {})

      next()
    } catch (err) {
      next(err)
    }
  }
}

/**
 * Role-based access control guard.
 * Call after `authenticate`.
 *
 * Usage:
 *   router.delete('/leads/:id', authenticate, authorize('ADMIN', 'MANAGER'), controller)
 */
export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(ApiError.unauthorized('Not authenticated'))
    }

    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `This action requires one of the following roles: ${roles.join(', ')}`
        )
      )
    }

    next()
  }
}
