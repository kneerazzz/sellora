import assert from 'node:assert/strict'
import { it } from 'node:test'

process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused'
process.env.REDIS_URL = 'redis://127.0.0.1:1'
process.env.JWT_ACCESS_SECRET = 'offline-access-secret-32-characters'
process.env.JWT_REFRESH_SECRET = 'offline-refresh-secret-32-characters'
const { prisma } = await import('../../config/prisma')
const { searchSimilarChunks } = await import('../vectorSearch')

it('returns low fusion scores and scopes both candidate branches to completed organization documents', async () => {
  const original = prisma.$queryRaw
  const calls: any[] = []
  const row = { chunkId: 'expected', score: 2 / 61 }
  prisma.$queryRaw = (async (query: any) => { calls.push(query); return [row] }) as any
  try {
    const rows = await searchSimilarChunks({ organizationId: 'org-a', queryVector: [1, 0], queryText: 'SAML SSO', documentIds: ['approved-doc'] })
    assert.deepEqual(rows, [row])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].values.filter((value: unknown) => value === 'org-a').length, 2)
    assert.equal(calls[0].values.filter((value: unknown) => value === 'approved-doc').length, 2)
    assert.equal((calls[0].sql.match(/d.status = 'COMPLETED'/g) ?? []).length, 2)
    assert.deepEqual(await searchSimilarChunks({ organizationId: 'org-a', queryVector: [1, 0], queryText: 'SAML SSO', documentIds: [] }), [])
    assert.equal(calls.length, 1)
  } finally {
    prisma.$queryRaw = original
  }
})
