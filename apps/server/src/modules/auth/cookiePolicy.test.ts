import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { refreshCookieOptions, refreshLifetimeMs } from './cookiePolicy'

describe('refresh cookie policy', () => {
  it('aligns the cookie lifetime with validated session units', () => {
    assert.equal(refreshLifetimeMs('30m'), 1_800_000)
    assert.equal(refreshLifetimeMs('7d'), 604_800_000)
    assert.throws(() => refreshLifetimeMs('0d'))
    assert.throws(() => refreshLifetimeMs('999999999999999999999d'))
  })

  it('requires Secure in production and retains the auth-only path', () => {
    const local = refreshCookieOptions('test', '30m')
    const production = refreshCookieOptions('production', '30m')
    assert.deepEqual({ httpOnly: local.httpOnly, sameSite: local.sameSite, path: local.path, maxAge: local.maxAge },
      { httpOnly: true, sameSite: 'lax', path: '/api/v1/auth', maxAge: 1_800_000 })
    assert.equal(local.secure, false)
    assert.equal(production.secure, true)
  })
})
