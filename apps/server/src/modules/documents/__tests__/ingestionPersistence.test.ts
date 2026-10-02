import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Prisma } from '@prisma/client'
import { persistIngestedChunks } from '../ingestionPersistence'
import { EMBEDDING_DIMENSIONS, validateEmbeddings } from '../../../utils/embeddingContract'

const vector = () => Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1)
const chunks = [{ text: 'A source', chunkIndex: 0, tokenCount: 2, overlapTokens: 0, headingPath: [], sectionTitle: null }]
function fixture() {
  const events: string[] = []
  let completion: any
  const tx = {
    documentChunk: {
      deleteMany: async () => { events.push('delete') },
      createMany: async () => { events.push('create') },
      findMany: async () => [{ id: 'chunk', chunkIndex: 0 }],
    },
    document: { update: async (input: any) => { events.push('complete'); completion = input.data; return input.data } },
  } as unknown as Prisma.TransactionClient
  return { events, tx, completion: () => completion }
}
describe('ingestion persistence', () => {
  it('writes vectors through the transaction before advertising completion', async () => {
    const f = fixture()
    await persistIngestedChunks(f.tx, { documentId: 'doc', chunks, embeddings: [vector()], isReingest: true }, async (rows, tx) => {
      assert.equal(tx, f.tx)
      assert.equal(rows[0]?.id, 'chunk')
      assert.equal(f.completion(), undefined)
      f.events.push('vectors')
    })
    assert.deepEqual(f.events, ['delete', 'create', 'vectors', 'complete'])
    assert.equal(f.completion().embeddingModel, 'nomic-embed-text')
  })
  it('propagates vector write failure without marking the document ready', async () => {
    const f = fixture()
    await assert.rejects(persistIngestedChunks(f.tx, { documentId: 'doc', chunks, embeddings: [vector()], isReingest: true }, async () => {
      throw new Error('vector write failed')
    }), /vector write failed/)
    assert.equal(f.completion(), undefined)
  })
  it('rejects invalid model output before replacing existing chunks', async () => {
    for (const embeddings of [[], [[1, 2]], [vector().fill(NaN)], [vector().fill(Infinity)], [vector().fill(0)]]) {
      const f = fixture()
      await assert.rejects(persistIngestedChunks(f.tx, { documentId: 'doc', chunks, embeddings, isReingest: true }, async () => {}))
      assert.deepEqual(f.events, [])
    }
  })
  it('does not claim an embedding model for lexical-only ingestion', async () => {
    const f = fixture()
    await persistIngestedChunks(f.tx, { documentId: 'doc', chunks, embeddings: null }, async () => { assert.fail('unexpected vector write') })
    assert.equal(f.completion().embeddingModel, null)
  })
  it('validates supported vectors and rejects strings masquerading as numbers', () => {
    validateEmbeddings([vector()], 1)
    const malformed = vector()
    malformed[0] = '0.1' as unknown as number
    assert.throws(() => validateEmbeddings([malformed], 1), /Invalid embedding/)
  })
})
