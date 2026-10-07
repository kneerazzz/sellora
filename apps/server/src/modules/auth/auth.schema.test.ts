import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { acceptInviteSchema, registerSchema, resetPasswordSchema } from './auth.schema'
import { changePasswordSchema } from '../users/users.schema'

const exactLimit = `Aa1${'€'.repeat(23)}`
const overLimit = `Aa1${'€'.repeat(24)}`

describe('password-setting schemas', () => {
  it('accepts a valid password at the bcrypt 72-byte boundary', () => {
    assert.equal(Buffer.byteLength(exactLimit, 'utf8'), 72)
    assert.equal(registerSchema.safeParse({ body: {
      firstName: 'Test', lastName: 'User', email: 'test@example.invalid', password: exactLimit,
      organizationName: 'Example', organizationSlug: 'example',
    } }).success, true)
    assert.equal(acceptInviteSchema.safeParse({ body: {
      token: 'token', firstName: 'Test', lastName: 'User', password: exactLimit,
    } }).success, true)
    assert.equal(resetPasswordSchema.safeParse({ body: { token: 'token', password: exactLimit } }).success, true)
    assert.equal(changePasswordSchema.safeParse({ body: {
      currentPassword: 'OldPassword1', newPassword: exactLimit,
    } }).success, true)
    assert.equal(acceptInviteSchema.safeParse({ body: {
      token: 'token', firstName: 'Test', lastName: 'User', password: 'simplepass',
    } }).success, true, 'invite complexity contract remains unchanged')
  })

  it('rejects multibyte passwords beyond bcrypt input capacity on every setting path', () => {
    assert.ok(overLimit.length < 72)
    assert.ok(Buffer.byteLength(overLimit, 'utf8') > 72)
    const results = [
      registerSchema.safeParse({ body: {
        firstName: 'Test', lastName: 'User', email: 'test@example.invalid', password: overLimit,
        organizationName: 'Example', organizationSlug: 'example',
      } }),
      acceptInviteSchema.safeParse({ body: {
        token: 'token', firstName: 'Test', lastName: 'User', password: overLimit,
      } }),
      resetPasswordSchema.safeParse({ body: { token: 'token', password: overLimit } }),
      changePasswordSchema.safeParse({ body: {
        currentPassword: 'OldPassword1', newPassword: overLimit,
      } }),
    ]
    assert.ok(results.every(result => !result.success))
    for (const result of results) {
      if (!result.success) assert.match(result.error.issues.map(issue => issue.message).join(' '), /72 UTF-8 bytes/)
    }
  })
})
