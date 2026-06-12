import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildGenericCrmPayload,
  buildHubSpotPayload,
  buildSalesforcePayload,
  normalizeSalesExtractionWorkflowOutput,
} from '../crmWritebackPayloads'

describe('crmWritebackPayloads utilities', () => {
  it('builds provider-specific CRM payloads from sales extraction output', () => {
    const output = normalizeSalesExtractionWorkflowOutput({
      extraction: {
        summary: 'Buyer asked about SSO.',
        nextSteps: ['Send SSO docs'],
        buyerQuestions: ['Do you support SSO?'],
        crmUpdate: {
          stage: 'Technical Validation',
        },
      },
      aiInteractionId: 'ai_1',
    })

    const salesforce = buildSalesforcePayload(output)
    const hubspot = buildHubSpotPayload(output)
    const generic = buildGenericCrmPayload(output)

    assert.equal(salesforce.fields.StageName, 'Technical Validation')
    assert.equal(hubspot.properties.hs_next_step, 'Send SSO docs')
    assert.equal(generic.aiInteractionId, 'ai_1')
  })
})
