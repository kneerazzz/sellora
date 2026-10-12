import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  JWT_ACCESS_SECRET: 'offline-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'offline-refresh-secret-at-least-32-characters',
  PROVIDER_INPUT_MAX_CHARS: '1000',
})

const { LocalEmbeddingProvider } = await import('./LocalEmbeddingProvider')

describe('LocalEmbeddingProvider operation contract', () => {
  it('preserves Nomic prefixes and validates vector shape', async () => {
    let received: string[] = []
    const provider = new LocalEmbeddingProvider({
      embedModel: {
        async getTextEmbeddings(texts) {
          received = texts
          return texts.map(() => Array.from({ length: 768 }, () => 0.1))
        },
      },
    })

    const vectors = await provider.embed(['pricing'], { isQuery: true })
    assert.deepEqual(received, ['search_query: pricing'])
    assert.equal(vectors[0]?.length, 768)
  })

  it('classifies malformed vectors as terminal validation failures', async () => {
    const provider = new LocalEmbeddingProvider({
      embedModel: { getTextEmbeddings: async () => [[0.1, 0.2]] },
    })

    await assert.rejects(provider.embed(['pricing']), (error: any) => {
      assert.equal(error.category, 'validation')
      assert.equal(error.attempts.length, 1)
      assert.equal(error.attempts[0].cancellation, 'wait_only')
      return true
    })
  })

  it('rejects oversized embedding input before local model dispatch', async () => {
    let dispatched = 0
    const provider = new LocalEmbeddingProvider({
      embedModel: { getTextEmbeddings: async () => { dispatched += 1; return [] } },
    })
    await assert.rejects(provider.embed(['x'.repeat(1001)]),
      (error: any) => error.category === 'validation' && error.attempts.length === 0)
    assert.equal(dispatched, 0)
  })

  it('stops waiting at its deadline while reporting the SDK cancellation limit', async () => {
    let dispatched = 0
    const outcomes: any[] = []
    const provider = new LocalEmbeddingProvider({
      embedModel: {
        getTextEmbeddings: async () => {
          dispatched += 1
          return new Promise<number[][]>(() => undefined)
        },
      },
      timing: {
        now: () => 0,
        sleep: async () => undefined,
      },
    })

    await assert.rejects(provider.embed(['pricing'], {
      deadlineAtMs: 100,
      onAttempt: outcome => outcomes.push(outcome),
    }), (error: any) => error.category === 'deadline')
    assert.equal(dispatched, 1)
    assert.equal(outcomes[0]?.cancellation, 'wait_only')
  })
})
