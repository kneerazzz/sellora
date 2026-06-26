import { NextFunction, Request, Response } from 'express'
import { ApiError } from '../utils/apiError'

const DEFAULT_WINDOW_MS = 60_000
const DEFAULT_MAX_REQUESTS = 60

type Bucket = {
  resetAt: number
  count: number
}

const buckets = new Map<string, Bucket>()

function cleanupExpiredBuckets(now: number) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key)
    }
  }
}

export function apiKeyRateLimit(options?: {
  windowMs?: number
  maxRequests?: number
}) {
  const windowMs = options?.windowMs ?? Number(process.env.API_KEY_RATE_LIMIT_WINDOW_MS ?? DEFAULT_WINDOW_MS)
  const maxRequests = options?.maxRequests ?? Number(process.env.API_KEY_RATE_LIMIT_MAX ?? DEFAULT_MAX_REQUESTS)

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      next()
      return
    }

    const now = Date.now()
    cleanupExpiredBuckets(now)

    const key = `${req.apiKey.organizationId}:${req.apiKey.id}`
    const bucket = buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    bucket.count += 1

    if (bucket.count > maxRequests) {
      next(ApiError.tooManyRequests('API key rate limit exceeded'))
      return
    }

    next()
  }
}
