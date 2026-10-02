import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Prisma } from '@prisma/client'
import { consumeRefreshToken, resolveCurrentUser } from './sessionPolicy'

const user = { id: 'user', email: 'staff@example.test', role: 'REP', organizationId: 'org', firstName: 'Staff', lastName: 'Member', isActive: true }
const claims = { sub: 'user', email: user.email, role: 'ADMIN' as const, organizationId: 'org' }
const mockUser = (value: unknown) => ({ user: { findUnique: async () => value } }) as unknown as Prisma.TransactionClient

describe('current session authorization', () => {
  it('uses current role rather than the older JWT administrator claim', async () => {
    const current = await resolveCurrentUser(mockUser(user), claims)
    assert.equal(current.role, 'REP')
  })
  it('rejects inactive, deleted and moved users', async () => {
    for (const value of [null, { ...user, isActive: false }, { ...user, organizationId: 'different-org' }]) {
      await assert.rejects(resolveCurrentUser(mockUser(value), claims), { statusCode: 401 })
    }
  })
  it('rejects malformed subject without querying user data', async () => {
    await assert.rejects(resolveCurrentUser({} as Prisma.TransactionClient, { ...claims, sub: undefined! }), { statusCode: 401 })
  })
})

describe('refresh consumption', () => {
  const stored = { id: 'session', userId: user.id, user, isRevoked: false, expiresAt: new Date(Date.now() + 60000) }
  it('only issues one replacement when two requests read the same active token', async () => {
    let consumed = false
    let issued = 0
    const tx = { refreshToken: {
      findUnique: async () => stored,
      updateMany: async (args: any) => {
        assert.equal(args.where.isRevoked, false)
        assert.equal(args.where.user.isActive, true)
        const count = consumed ? 0 : 1
        consumed = true
        return { count }
      },
    } } as unknown as Prisma.TransactionClient
    const issuer = async (_user: unknown, transaction: Prisma.TransactionClient) => {
      assert.equal(transaction, tx)
      issued++
      return 'replacement'
    }
    const results = await Promise.allSettled([consumeRefreshToken(tx, 'hash', issuer), consumeRefreshToken(tx, 'hash', issuer)])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(issued, 1)
  })
  it('rejects replay and expiration without revoking other sessions', async () => {
    for (const value of [null, { ...stored, isRevoked: true }, { ...stored, expiresAt: new Date(0) }]) {
      const tx = { refreshToken: { findUnique: async () => value, updateMany: async () => assert.fail('unexpected revoke') } } as unknown as Prisma.TransactionClient
      await assert.rejects(consumeRefreshToken(tx, 'hash', async () => assert.fail('unexpected issue')), { statusCode: 401 })
    }
  })
  it('propagates replacement failure so the outer transaction can roll back', async () => {
    const tx = { refreshToken: { findUnique: async () => stored, updateMany: async () => ({ count: 1 }) } } as unknown as Prisma.TransactionClient
    await assert.rejects(consumeRefreshToken(tx, 'hash', async () => { throw new Error('insert failed') }), /insert failed/)
  })
})
