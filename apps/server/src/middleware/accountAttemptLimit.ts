import { createHmac } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../config/prisma'
import { env } from '../config/env'
import { ApiError } from '../utils/apiError'

// One bounded counter per socket address and operation; no account existence
// lookup, attacker-supplied forwarding headers, raw IP, email or token stored.
export async function consumeAccountAttempt(operation: string, address: string) {
  const key = createHmac('sha256', env.JWT_ACCESS_SECRET).update(`${operation}:${address}`).digest('hex')
  const max = env.AUTH_ATTEMPT_MAX
  const seconds = env.AUTH_ATTEMPT_WINDOW_SECONDS
  const rows = await prisma.$queryRaw<Array<{ count: number; retryAfter: number }>>`
    INSERT INTO auth_attempt_buckets (key, count, "resetAt")
    VALUES (${key}, 1, clock_timestamp() + ${seconds} * interval '1 second')
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN auth_attempt_buckets."resetAt" <= clock_timestamp() THEN 1
                   ELSE LEAST(auth_attempt_buckets.count + 1, ${max + 1}) END,
      "resetAt" = CASE WHEN auth_attempt_buckets."resetAt" <= clock_timestamp()
                       THEN clock_timestamp() + ${seconds} * interval '1 second'
                       ELSE auth_attempt_buckets."resetAt" END
    RETURNING count, GREATEST(1, CEIL(EXTRACT(EPOCH FROM ("resetAt" - clock_timestamp()))))::int AS "retryAfter"`
  // Bounded expiry cleanup; a process restart never resets active counters.
  await prisma.$executeRaw`DELETE FROM auth_attempt_buckets WHERE key IN (
    SELECT key FROM auth_attempt_buckets WHERE "resetAt" < clock_timestamp() - interval '1 day' LIMIT 100)`
  return { allowed: rows[0]!.count <= max, retryAfter: rows[0]!.retryAfter }
}

export function accountAttemptLimit(operation: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await consumeAccountAttempt(operation, req.socket.remoteAddress ?? 'unknown')
      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter)
        throw ApiError.tooManyRequests('Too many account attempts. Try again later.')
      }
      next()
    } catch (error) { next(error) } // Database failure denies admission.
  }
}
