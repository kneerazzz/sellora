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
    assert.equal(config.PROVIDER_OPERATION_TIMEOUT_MS, 30_000)
    assert.equal(config.PROVIDER_MAX_ATTEMPTS, 3)
    assert.equal(config.PROVIDER_CONCURRENCY_MAX, 4)
    assert.equal(config.PROVIDER_PERIOD_UNITS_MAX, 1_000_000)
    assert.equal(config.PROVIDER_RESPONSE_MAX_BYTES, 1_048_576)
    assert.equal(config.PROVIDER_QUESTION_MAX, 50)
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
      { LOCAL_EMBEDDING_SERVICE_URL: 'invalid' }, { DOCUMENT_UPLOAD_MAX_BYTES: '-1' },
      { PROVIDER_OPERATION_TIMEOUT_MS: '99' }, { PROVIDER_MAX_ATTEMPTS: '0' },
      { PROVIDER_MAX_ATTEMPTS: '6' }, { PROVIDER_RETRY_BASE_DELAY_MS: '-1' },
      { PROVIDER_CONCURRENCY_MAX: '0' }, { PROVIDER_PERIOD_UNITS_MAX: '0' },
      { PROVIDER_PERIOD_SECONDS: '0' }, { PROVIDER_RESERVATION_TTL_SECONDS: '0' },
      { PROVIDER_REQUEST_MAX_BYTES: '100' }, { PROVIDER_RESPONSE_MAX_BYTES: '100' },
      { PROVIDER_INPUT_MAX_CHARS: '999' }, { PROVIDER_QUESTION_MAX: '0' },
      { DOCUMENT_EXTRACTED_MAX_CHARS: '999' }, { DOCUMENT_MAX_PAGES: '0' },
      { JWT_REFRESH_EXPIRES_IN: '0d' }, { JWT_REFRESH_EXPIRES_IN: '999999999999999999999d' },
      { SLACK_ALERT_WEBHOOK_URL: 'https://example.com/hook' }]) {
      assert.equal(envSchema.safeParse({ ...required, ...patch }).success, false)
    }
    const result = envSchema.safeParse({ ...required, JWT_ACCESS_SECRET: 'private-short-value' })
    if (!result.success) assert.doesNotMatch(JSON.stringify(result.error.flatten().fieldErrors), /private-short-value/)
  })
})
