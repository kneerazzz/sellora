import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildLocalVectorIds,
  chunkText,
  inferDocumentType,
  inferMimeType,
  sanitizeFilename,
} from '../documentProcessing'

describe('documentProcessing utilities', () => {
  it('infers supported document types from filename or MIME type', () => {
    assert.equal(inferDocumentType('security.md'), 'MARKDOWN')
    assert.equal(inferDocumentType('notes.txt'), 'TXT')
    assert.equal(inferDocumentType('guide', 'application/pdf'), 'PDF')
    assert.equal(inferMimeType('MARKDOWN'), 'text/markdown')
  })

  it('sanitizes filenames and builds stable local vector IDs', () => {
    assert.equal(sanitizeFilename('../Sales Playbook.md'), 'Sales_Playbook.md')
    assert.deepEqual(buildLocalVectorIds('doc_1', 3), [
      'local:doc_1:0',
      'local:doc_1:1',
      'local:doc_1:2',
    ])
  })

  it('chunks non-empty text', () => {
    const chunks = chunkText('First paragraph.\n\nSecond paragraph.', 20)

    assert.ok(chunks.length >= 1)
    assert.equal(chunks[0].includes('First'), true)
  })
})
