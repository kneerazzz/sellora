import type { CookieOptions } from 'express'

export function refreshLifetimeMs(value: string): number {
  const match = value.match(/^([1-9]\d*)([dhms])$/)
  if (!match) throw new Error('Invalid refresh lifetime')
  const units: Record<string, number> = { d: 86_400_000, h: 3_600_000, m: 60_000, s: 1_000 }
  const duration = Number(match[1]) * units[match[2]!]!
  if (!Number.isSafeInteger(duration)) throw new Error('Refresh lifetime is too large')
  return duration
}

export function refreshCookieOptions(nodeEnv: string, lifetime: string): CookieOptions {
  return {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: refreshLifetimeMs(lifetime),
    path: '/api/v1/auth',
  }
}
