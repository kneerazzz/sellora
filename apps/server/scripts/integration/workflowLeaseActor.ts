export {}

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Disposable target required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Local disposable target required')
}
process.env.DATABASE_URL = target
const { prisma } = await import('../../src/config/prisma')
const { claimWorkflow } = await import('../../src/modules/workflowRuns/workflowLease')
const claim = await claimWorkflow({ organizationId: process.env.WORKFLOW_TEST_ORG_ID })
process.stdout.write(`${JSON.stringify(claim)}\n`)
if (process.env.WORKFLOW_TEST_HOLD === '1') {
  await new Promise<void>(() => { setInterval(() => {}, 1_000) })
} else {
  await prisma.$disconnect()
}
