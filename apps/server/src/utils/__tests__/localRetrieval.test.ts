import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildExtractiveAnswer,
  buildSnippet,
  scoreByTokenOverlap,
  tokenizeForRetrieval,
} from '../localRetrieval'

describe('localRetrieval utilities', () => {
  it('tokenizes questions and scores chunk overlap', () => {
    const tokens = tokenizeForRetrieval('Do we support SAML SSO for buyers?')

    assert.deepEqual(tokens, ['support', 'saml', 'sso', 'buyers'])
    assert.equal(scoreByTokenOverlap(tokens, 'SAML SSO is supported.'), 3)
  })

  it('builds compact snippets and extractive answers', () => {
    const snippet = buildSnippet('A '.repeat(300), 20)
    const answer = buildExtractiveAnswer('Question?', ['Evidence one.', 'Evidence two.'])

    assert.equal(snippet.endsWith('...'), true)
    assert.match(answer, /1\. Evidence one\./)
    assert.match(answer, /2\. Evidence two\./)
  })
})
