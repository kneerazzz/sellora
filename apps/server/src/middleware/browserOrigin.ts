import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env'
import { ApiError } from '../utils/apiError'

export function browserOrigin(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.get('origin')
  const allowed = new URL(env.CLIENT_URL).origin
  // Cookie-based mutations require explicit origin. Nonbrowser bearer callers
  // without cookies may omit Origin; they cannot use cookies to bypass this.
  if ((origin && origin !== allowed) || (!origin && req.cookies?.refreshToken) || req.get('sec-fetch-site') === 'cross-site') {
    return next(ApiError.forbidden('Request origin is not permitted'))
  }
  next()
}
