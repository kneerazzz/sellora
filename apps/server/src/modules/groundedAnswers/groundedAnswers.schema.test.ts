import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { groundedAnswerSchema } from './groundedAnswers.schema'

describe('groundedAnswerSchema', () => {
  it('accepts a question and defaults citation count', () => {
    const parsed = groundedAnswerSchema.parse({
      body: {
        question: 'What does the implementation guide say about rollout risk?',
      },
    })

    assert.equal(parsed.body.maxCitations, 5)
  })
})
