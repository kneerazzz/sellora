import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createDocumentSchema,
  ingestDocumentTextSchema,
  uploadDocumentSchema,
} from './documents.schema'

describe('documents schemas', () => {
  it('accepts document metadata for an uploaded text file', () => {
    const parsed = createDocumentSchema.parse({
      body: {
        filename: 'playbook.md',
        displayName: 'Sales Playbook',
        mimeType: 'text/markdown',
        sizeBytes: 1200,
        fileType: 'MARKDOWN',
        storagePath: 'org-1/playbook.md',
        tags: ['sales', 'playbook'],
      },
    })

    assert.equal(parsed.body.fileType, 'MARKDOWN')
    assert.deepEqual(parsed.body.tags, ['sales', 'playbook'])
  })

  it('defaults the placeholder embedding model for manual text ingestion', () => {
    const parsed = ingestDocumentTextSchema.parse({
      params: { id: 'clw0000000000000000000000' },
      body: {
        text: 'A technical product note for retrieval.',
      },
    })

    assert.equal(parsed.body.embeddingModel, 'local-placeholder')
  })

  it('accepts uploaded markdown content', () => {
    const parsed = uploadDocumentSchema.parse({
      body: {
        filename: 'security.md',
        content: '# Security\n\nSAML SSO is supported.',
        tags: ['security'],
      },
    })

    assert.equal(parsed.body.encoding, 'utf8')
    assert.equal(parsed.body.filename, 'security.md')
  })
})
