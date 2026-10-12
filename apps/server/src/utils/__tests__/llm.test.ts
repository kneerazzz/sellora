import assert from 'node:assert/strict'
import { it } from 'node:test'

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  JWT_ACCESS_SECRET: 'offline-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'offline-refresh-secret-at-least-32-characters',
  AI_PROVIDER: 'groq',
  GROQ_API_KEY: 'offline-provider-key',
})

const { callLlm } = await import('../llm')

it('generation uses the provider boundary and validates token fields', async () => {
  let dispatches = 0
  const result = await callLlm({
    systemPrompt: 'system',
    userPrompt: 'user',
    operation: {
      policy: { maxAttempts: 1 },
      dependencies: {
        fetch: async () => {
          dispatches += 1
          return Response.json({
            choices: [{ message: { content: 'answer' } }],
            usage: { prompt_tokens: 4, completion_tokens: 2 },
          })
        },
      },
    },
  })

  assert.equal(dispatches, 1)
  assert.equal(result.text, 'answer')
  assert.equal(result.promptTokens, 4)
  assert.equal(result.attempts?.[0]?.outcome, 'success')
})

it('generation treats malformed successful output as terminal validation failure', async () => {
  let dispatches = 0
  await assert.rejects(callLlm({
    systemPrompt: 'system',
    userPrompt: 'user',
    operation: {
      policy: { maxAttempts: 3 },
      dependencies: {
        fetch: async () => {
          dispatches += 1
          return Response.json({ choices: [] })
        },
      },
    },
  }), (error: any) => error.category === 'validation' && error.attempts.length === 1)
  assert.equal(dispatches, 1)
})
