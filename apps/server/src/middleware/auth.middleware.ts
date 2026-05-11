import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { ApiError } from '../utils/apiError'
import { prisma } from '../config/prisma'
import type { JwtAccessPayload } from '../types/auth.types'
import { UserRole } from '@prisma/client'

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
    const authHeader = req.headers.authorization
    
    if (!authHeader?.startsWith('Bearer ')) {
      throw ApiError.unauthorized('No token provided')
    }

    const token = authHeader.split(' ')[1]

    let payload: JwtAccessPayload
    try {
      payload = jwt.verify(
        token,
        process.env.JWT_ACCESS_SECRET as string
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