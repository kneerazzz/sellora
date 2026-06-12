import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crmWritebackPreviewSchema } from './crmWriteback.schema'

describe('crmWritebackPreviewSchema', () => {
  it('defaults the external object type to LEAD', () => {
    const parsed = crmWritebackPreviewSchema.parse({
      body: {
        workflowRunId: 'clw0000000000000000000000',
        provider: 'SALESFORCE',
      },
    })

    assert.equal(parsed.body.externalObjectType, 'LEAD')
  })
})
