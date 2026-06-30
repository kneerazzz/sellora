import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { aiExtractionsService } from '../src/modules/aiExtractions/aiExtractions.service'
import { prisma } from '../src/config/prisma'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

async function test() {
  const org = await prisma.organization.findFirst()
  if (!org) throw new Error('No org found')

  const rfpText = `Request for Proposal
Payment Processing & Integration Services
Issued by: TechVenture Inc.
RFP Reference: TVX-2026-PAY-001
Issue Date: June 29, 2026
Response Deadline: July 25, 2026
Contact: procurement@techventure.io
1. Introduction & Background
TechVenture Inc. is a B2B SaaS company currently processing approximately $4M in monthly transaction
volume across 18 countries. We are evaluating payment infrastructure providers to power our checkout,
subscription billing, and marketplace payout flows as we scale.
Q1 - Supported Payment Methods
Which local payment methods does Stripe support for India, Brazil, Germany, and Southeast Asia?
Q2 - Subscription Billing & Proration
How does Stripe Billing handle mid-cycle upgrades/downgrades?
Q3 - Stripe Connect
Explain Standard, Express, and Custom accounts.
Q4 - Radar
Describe Radar fraud prevention and liability.
Q5 - Webhooks
Explain retries, duplicates, replay.
Q6 - API Limits
Default API rate limits and scaling.
Q7 - PCI DSS
PCI compliance scope.
Q8 - Pricing
Transaction fees and volume pricing.
Q9 - Sandbox
Testing environment and test cards.

Q10 - SLA
Uptime SLA and support.`

  console.log('Testing extractAndAnswerRfp...')
  try {
    const result = await aiExtractionsService.extractAndAnswerRfp(
      { content: rfpText },
      { organizationId: org.id }
    )
    console.log('SUCCESS:', result)
  } catch (err) {
    console.error('Test failed with error:', err)
  }
}

test().finally(() => prisma.$disconnect())
