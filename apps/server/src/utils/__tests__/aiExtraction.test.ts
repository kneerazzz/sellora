import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeWebhookPayloadForExtraction } from '../aiExtraction'

describe('normalizeWebhookPayloadForExtraction', () => {
  it('maps email webhook payloads into extraction input', () => {
    const input = normalizeWebhookPayloadForExtraction({
      eventType: 'EMAIL_RECEIVED',
      payload: {
        subject: 'Pricing follow-up',
        body: 'Can you send implementation timing and pricing?',
        participants: ['buyer@example.com', 'rep@example.com'],
      },
    })

    assert.equal(input.sourceType, 'EMAIL')
    assert.equal(input.subject, 'Pricing follow-up')
    assert.equal(input.content, 'Can you send implementation timing and pricing?')
    assert.deepEqual(input.participants, ['buyer@example.com', 'rep@example.com'])
  })

  it('maps call transcript webhooks into call transcript input', () => {
    const input = normalizeWebhookPayloadForExtraction({
      eventType: 'CALL_TRANSCRIPT_RECEIVED',
      payload: {
        transcript: 'Buyer asked about security review and rollout risk.',
      },
    })

    assert.equal(input.sourceType, 'CALL_TRANSCRIPT')
    assert.equal(input.content, 'Buyer asked about security review and rollout risk.')
  })

  it('falls back to JSON content for unknown payload shapes', () => {
    const input = normalizeWebhookPayloadForExtraction({
      eventType: 'CUSTOM',
      payload: {
        nested: {
          value: true,
        },
      },
    })

    assert.equal(input.sourceType, 'CRM_NOTE')
    assert.equal(input.content, '{"nested":{"value":true}}')
  })
})
