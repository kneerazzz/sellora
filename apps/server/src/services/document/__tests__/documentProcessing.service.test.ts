import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  chunkText,
  extractDocumentText,
  inferDocumentType,
  inferMimeType,
  sanitizeFilename,
} from '../documentProcessing.service'

describe('documentProcessing utilities', () => {
  it('infers supported document types from filename or MIME type', () => {
    assert.equal(inferDocumentType('security.md'), 'MARKDOWN')
    assert.equal(inferDocumentType('notes.txt'), 'TXT')
    assert.equal(inferDocumentType('guide', 'application/pdf'), 'PDF')
    assert.equal(inferMimeType('MARKDOWN'), 'text/markdown')
  })

  it('sanitizes filenames', () => {
    assert.equal(sanitizeFilename('../Sales Playbook.md'), 'Sales_Playbook.md')
  })

  it('chunks non-empty text', () => {
    const chunks = chunkText('First paragraph.\n\nSecond paragraph.', 20)

    assert.ok(chunks.length >= 1)
    assert.equal(chunks[0].includes('First'), true)
  })

  it('extracts text from text buffers', async () => {
    const extracted = await extractDocumentText({
      fileType: 'TXT',
      buffer: Buffer.from('Plain text document'),
    })

    assert.equal(extracted.text, 'Plain text document')
  })
})
