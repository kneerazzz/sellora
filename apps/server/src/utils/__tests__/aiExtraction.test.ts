import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

Object.assign(process.env, {
  DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/unused',
  JWT_ACCESS_SECRET: 'offline-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'offline-refresh-secret-at-least-32-characters',
  AI_PROVIDER: 'groq',
  GROQ_API_KEY: 'offline-provider-key',
  PROVIDER_QUESTION_MAX: '2',
})

const {
  callLlmForSalesExtraction,
  callLlmForRfpExtraction,
  normalizeWebhookPayloadForExtraction,
} = await import('../aiExtraction')

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

describe('sales extraction provider boundary', () => {
  it('validates structured output and exposes the successful attempt', async () => {
    let dispatches = 0
    const extraction = {
      summary: 'Buyer requested pricing.',
      nextSteps: ['Send pricing'],
      buyerQuestions: ['What does the platform cost?'],
      objections: [],
      riskFlags: [],
      crmUpdate: { stage: null, lastActivitySummary: null, nextFollowUpAt: null, priority: null },
      confidence: 'HIGH',
      confidenceReason: 'Explicit request',
    }

    const result = await callLlmForSalesExtraction({
      sourceType: 'EMAIL',
      content: 'What does it cost?',
      leadId: undefined,
      dealId: undefined,
    }, {
      policy: { maxAttempts: 1 },
      dependencies: {
        fetch: async () => {
          dispatches += 1
          return Response.json({ choices: [{ message: { content: JSON.stringify(extraction) } }], usage: {} })
        },
      },
    })

    assert.equal(dispatches, 1)
    assert.deepEqual(result.output, extraction)
    assert.equal(result.attempts.length, 1)
    assert.equal(result.attempts[0]?.outcome, 'success')
  })

  it('rejects malformed structured output without retrying', async () => {
    let dispatches = 0
    await assert.rejects(
      callLlmForSalesExtraction({
        sourceType: 'EMAIL',
        content: 'Hello',
        leadId: undefined,
        dealId: undefined,
      }, {
        policy: { maxAttempts: 3 },
        dependencies: {
          fetch: async () => {
            dispatches += 1
            return Response.json({ choices: [{ message: { content: '{"summary":' } }] })
          },
        },
      }),
      (error: any) => error.category === 'validation' && error.attempts.length === 1
    )
    assert.equal(dispatches, 1)
  })

  it('rejects malformed token usage without retrying', async () => {
    let dispatches = 0
    const extraction = {
      summary: 'Buyer requested pricing.', nextSteps: [], buyerQuestions: [], objections: [], riskFlags: [],
      crmUpdate: { stage: null, lastActivitySummary: null, nextFollowUpAt: null, priority: null },
      confidence: 'LOW', confidenceReason: 'Fixture',
    }
    await assert.rejects(callLlmForSalesExtraction({
      sourceType: 'EMAIL', content: 'Hello, please send current pricing details.', leadId: undefined, dealId: undefined,
    }, {
      policy: { maxAttempts: 3 },
      dependencies: { fetch: async () => {
        dispatches += 1
        return Response.json({ choices: [{ message: { content: JSON.stringify(extraction) } }], usage: { prompt_tokens: -1 } })
      } },
    }), (error: any) => error.category === 'validation' && error.attempts.length === 1)
    assert.equal(dispatches, 1)
  })
})

describe('RFP extraction provider boundary', () => {
  it('rejects question output beyond the configured cap without retrying', async () => {
    let dispatches = 0
    await assert.rejects(callLlmForRfpExtraction({
      content: 'A sufficiently detailed synthetic request for proposal questionnaire.',
    }, {
      policy: { maxAttempts: 3 },
      dependencies: { fetch: async () => {
        dispatches += 1
        return Response.json({
          choices: [{ message: { content: JSON.stringify({ questions: Array.from({ length: 3 }, (_, i) => `Question ${i}`) }) } }],
          usage: {},
        })
      } },
    }), (error: any) => error.category === 'validation' && error.attempts.length === 1)
    assert.equal(dispatches, 1)
  })
})
