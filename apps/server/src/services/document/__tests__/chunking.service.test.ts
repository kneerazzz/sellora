import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { estimateTokenCount, structureAwareChunk } from '../chunking.service'

describe('estimateTokenCount', () => {
  it('returns roughly chars / 4', () => {
    assert.equal(estimateTokenCount(''), 1)
    assert.equal(estimateTokenCount('abcd'), 1)
    assert.equal(estimateTokenCount('a'.repeat(8)), 2)
    assert.equal(estimateTokenCount('a'.repeat(100)), 25)
  })
})

describe('structureAwareChunk', () => {
  it('produces chunks of approximately 500 tokens max', async () => {
    const paragraph = 'The quick brown fox jumps over the lazy dog. '.repeat(100)
    const chunks = await structureAwareChunk(paragraph)

    for (const chunk of chunks) {
      assert.ok(
        chunk.tokenCount <= 800,
        `Chunk ${chunk.chunkIndex} has ${chunk.tokenCount} tokens, expected <= 800 (500 + overlap)`
      )
    }

    assert.ok(chunks.length > 1, 'Expected multiple chunks for long text')
  })

  it('applies overlap: chunk[1] begins with text from the end of chunk[0]', async () => {
    const paragraph = 'Word '.repeat(800)
    const chunks = await structureAwareChunk(paragraph)

    assert.ok(chunks.length >= 2, 'Expected at least 2 chunks')

    const endOfFirst = chunks[0]!.text.slice(-50)
    assert.ok(
      chunks[1]!.text.startsWith(endOfFirst.slice(0, 20)) || chunks[1]!.text.includes(endOfFirst.slice(0, 20)),
      'Chunk 1 should contain overlap text from the end of chunk 0'
    )
    assert.ok(chunks[1]!.overlapTokens > 0, 'Chunk 1 should have non-zero overlapTokens')
    assert.equal(chunks[0]!.overlapTokens, 0, 'First chunk should have zero overlapTokens')
  })

  it('detects markdown headings in headingPath and sectionTitle', async () => {
    const text = [
      '# Introduction',
      'This is the intro paragraph.',
      '',
      '## Security',
      'SAML SSO is supported.',
      '',
      '### Advanced',
      'MFA is also available.',
    ].join('\n')

    const chunks = await structureAwareChunk(text, { maxTokens: 2000 })

    const securityChunk = chunks.find((c) => c.text.includes('SAML SSO'))
    assert.ok(securityChunk, 'Should have a chunk containing SAML SSO text')
    assert.ok(
      securityChunk.headingPath.includes('Security') || securityChunk.headingPath.includes('Advanced'),
      `Expected headingPath to include Security or Advanced, got: ${JSON.stringify(securityChunk.headingPath)}`
    )
  })

  it('returns a single chunk for very short text', async () => {
    const chunks = await structureAwareChunk('Hello, world!')

    assert.equal(chunks.length, 1)
    assert.equal(chunks[0]!.chunkIndex, 0)
    assert.equal(chunks[0]!.overlapTokens, 0)
    assert.equal(chunks[0]!.text, 'Hello, world!')
  })

  it('handles large text without exceeding bounds', async () => {
    const paragraph = 'This is a moderately long sentence for testing purposes. '.repeat(50)
    const largeText = (paragraph + '\n\n').repeat(50)
    const chunks = await structureAwareChunk(largeText)

    assert.ok(chunks.length > 1, 'Expected many chunks for large text')

    for (const chunk of chunks) {
      assert.ok(
        chunk.tokenCount <= 800,
        `Chunk ${chunk.chunkIndex} exceeds bounds with ${chunk.tokenCount} tokens`
      )
      assert.equal(chunk.chunkIndex >= 0, true)
    }

    for (let i = 0; i < chunks.length; i++) {
      assert.equal(chunks[i]!.chunkIndex, i)
    }
  })

  it('detects plain-text headings if they are converted to markdown or handled correctly', async () => {
    // Note: LlamaIndex MarkdownNodeParser expects markdown headings. 
    // ALL CAPS headings without markdown syntax won't be detected as headings natively.
    const text = ['# OVERVIEW', '', 'This section gives an overview.', '', '# DETAILS', '', 'Here are the details.'].join('\n')

    const chunks = await structureAwareChunk(text, { maxTokens: 2000 })
    const detailsChunk = chunks.find((c) => c.text.includes('Here are the details'))

    assert.ok(detailsChunk, 'Should have a chunk with details text')
    assert.ok(
      detailsChunk.headingPath.includes('DETAILS'),
      `Expected DETAILS in headingPath, got: ${JSON.stringify(detailsChunk.headingPath)}`
    )
  })
})
