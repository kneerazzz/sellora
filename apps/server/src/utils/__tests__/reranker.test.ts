import assert from 'node:assert/strict'
import { it } from 'node:test'

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  JWT_ACCESS_SECRET: 'offline-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'offline-refresh-secret-at-least-32-characters',
  PROVIDER_INPUT_MAX_CHARS: '1000',
})

const { rerank } = await import('../reranker')

it('reranker observes cancellation before loading the local model', async () => {
  const controller = new AbortController()
  controller.abort(new Error('caller stopped'))

  await assert.rejects(rerank({
    items: [{ item: { text: 'pricing' }, score: 0.5 }],
    question: 'pricing',
    getText: item => item.text,
    limit: 1,
    operation: { signal: controller.signal },
  }), (error: any) => {
    assert.equal(error.category, 'cancelled')
    assert.equal(error.attempts.length, 0)
    return true
  })
})

it('reranker rejects malformed logits instead of silently succeeding with fallback scores', async () => {
  await assert.rejects(rerank({
    items: [{ item: { text: 'pricing' }, score: 0.5 }],
    question: 'pricing',
    getText: item => item.text,
    limit: 1,
    dependencies: {
      loadReranker: async () => ({
        tokenizer: () => ({}),
        model: async () => ({ logits: { data: [Number.NaN] } }),
      }),
    },
  }), (error: any) => {
    assert.equal(error.category, 'validation')
    assert.equal(error.attempts.length, 1)
    assert.equal(error.attempts[0]?.outcome, 'failed')
    return true
  })
})

it('reranker rejects oversized input before loading the model', async () => {
  let loads = 0
  await assert.rejects(rerank({
    items: [{ item: { text: 'x'.repeat(1001) }, score: 0.5 }],
    question: 'pricing',
    getText: item => item.text,
    limit: 1,
    dependencies: { loadReranker: async () => { loads += 1; throw new Error('must not load') } },
  }), (error: any) => error.category === 'validation' && error.attempts.length === 0)
  assert.equal(loads, 0)
})
