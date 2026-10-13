import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Prisma } from '@prisma/client'
import { persistIngestedChunks } from '../ingestionPersistence'
import { EMBEDDING_DIMENSIONS, validateEmbeddings } from '../../../utils/embeddingContract'

const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)
const chunks = [{ text: 'A source', chunkIndex: 0, tokenCount: 2, overlapTokens: 0, headingPath: [], sectionTitle: null }]
const params = { documentId: 'doc', versionId: 'version', expectedActiveVersionId: 'old', chunks,
  embeddings: [vector()] }
function fixture(publishCount = 1) {
  const events: string[] = []
  let publication: any
  const tx = {
    documentVersion: {
      findUniqueOrThrow: async () => ({ documentId: 'doc', organizationId: 'org', status: 'BUILDING',
        filename: 'file.txt', mimeType: 'text/plain', sizeBytes: 8, fileType: 'TXT', storagePath: '/original' }),
      updateMany: async () => { events.push('retire') },
      update: async () => { events.push('activate') },
    },
    documentChunk: {
      createMany: async () => { events.push('create') },
      findMany: async () => [{ id: 'chunk', chunkIndex: 0 }],
    },
    document: {
      updateMany: async (input: any) => { events.push('publish'); publication = input; return { count: publishCount } },
      findUniqueOrThrow: async () => ({ id: 'doc' }),
    },
  } as unknown as Prisma.TransactionClient
  return { events, tx, publication: () => publication }
}
describe('version publication', () => {
  it('writes vectors before atomically changing the active pointer', async () => {
    const f = fixture()
    await persistIngestedChunks(f.tx, params, async (rows, tx) => {
      assert.equal(tx, f.tx)
      assert.equal(rows[0]?.id, 'chunk')
      assert.equal(f.publication(), undefined)
      f.events.push('vectors')
    })
    assert.deepEqual(f.events, ['create', 'vectors', 'publish', 'retire', 'activate'])
    assert.equal(f.publication().data.activeVersionId, 'version')
    assert.equal(f.publication().data.embeddingModel, 'nomic-embed-text')
  })
  it('rejects a changed active pointer without activating the candidate', async () => {
    const f = fixture(0)
    await assert.rejects(persistIngestedChunks(f.tx, params, async () => {}), /Active document version changed/)
    assert.deepEqual(f.events, ['create', 'publish'])
  })
  it('propagates vector write failure without publishing', async () => {
    const f = fixture()
    await assert.rejects(persistIngestedChunks(f.tx, params, async () => { throw new Error('vector write failed') }), /vector write failed/)
    assert.equal(f.publication(), undefined)
  })
  it('rejects invalid model output before any writes', async () => {
    for (const embeddings of [[], [[1, 2]], [vector().fill(NaN)], [vector().fill(Infinity)], [vector().fill(0)]]) {
      const f = fixture()
      await assert.rejects(persistIngestedChunks(f.tx, { ...params, embeddings }, async () => {}))
      assert.deepEqual(f.events, [])
    }
  })
  it('does not claim an embedding model for lexical-only publication', async () => {
    const f = fixture()
    await persistIngestedChunks(f.tx, { ...params, embeddings: null }, async () => { assert.fail('unexpected vector write') })
    assert.equal(f.publication().data.embeddingModel, null)
  })
  it('rejects strings masquerading as vector coordinates', () => {
    validateEmbeddings([vector()], 1)
    const malformed = vector()
    malformed[0] = '0.1' as unknown as number
    assert.throws(() => validateEmbeddings([malformed], 1), /Invalid embedding/)
  })
})
