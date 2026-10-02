import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { envSchema } from './env.schema'

const required = {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/sellora_test_config',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
}

describe('supported startup configuration', () => {
  it('needs no Redis or provider key for offline startup', () => {
    const config = envSchema.parse(required)
    assert.equal(config.EMBEDDING_PROVIDER, 'local')
    assert.equal(config.PORT, 4000)
    assert.equal('REDIS_URL' in config, false)
  })

  it('rejects unsupported embeddings with an actionable error', () => {
    const result = envSchema.safeParse({ ...required, EMBEDDING_PROVIDER: 'openai' })
    assert.equal(result.success, false)
    if (!result.success) assert.match(result.error.issues[0]!.message, /Only local Nomic\/768/)
  })

  it('rejects missing secrets and malformed service settings without echoing values', () => {
    for (const field of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL']) {
      assert.equal(envSchema.safeParse({ ...required, [field]: undefined }).success, false)
    }
    for (const patch of [{ PORT: '0' }, { PORT: '65536' }, { CLIENT_URL: 'invalid' },
      { LOCAL_EMBEDDING_SERVICE_URL: 'invalid' }, { DOCUMENT_UPLOAD_MAX_BYTES: '-1' }]) {
      assert.equal(envSchema.safeParse({ ...required, ...patch }).success, false)
    }
    const result = envSchema.safeParse({ ...required, JWT_ACCESS_SECRET: 'private-short-value' })
    if (!result.success) assert.doesNotMatch(JSON.stringify(result.error.flatten().fieldErrors), /private-short-value/)
  })
})
