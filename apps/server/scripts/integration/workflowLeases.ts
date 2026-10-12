import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Disposable target required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Local disposable target required')
}
process.env.DATABASE_URL = target
const { prisma } = await import('../../src/config/prisma')
const { claimWorkflow, finalizeWorkflow, heartbeatWorkflow, retryDelayMs } = await import('../../src/modules/workflowRuns/workflowLease')
type Claim = NonNullable<Awaited<ReturnType<typeof claimWorkflow>>>
const children: Array<ReturnType<typeof spawn>> = []

async function actor(orgId: string, hold = false): Promise<{ claim: Claim | null; child: ReturnType<typeof spawn> }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/integration/workflowLeaseActor.ts'], {
    env: { ...process.env, WORKFLOW_TEST_ORG_ID: orgId, WORKFLOW_TEST_HOLD: hold ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  child.stderr!.resume()
  let output = ''
  const claim = await new Promise<Claim | null>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Lease actor timed out')), 20_000)
    child.stdout!.on('data', data => {
      output += String(data)
      if (output.includes('\n')) {
        clearTimeout(timeout)
        resolve(JSON.parse(output.split('\n')[0]!) as Claim | null)
      }
    })
    child.on('exit', code => { if (!output.includes('\n')) { clearTimeout(timeout); reject(new Error(`Lease actor exited ${code}`)) } })
  })
  return { claim, child }
}

try {
  const org = await prisma.organization.create({ data: { name: 'Workflow lease fixture', slug: 'workflow-lease-fixture' } })
  const run = await prisma.workflowRun.create({ data: { organizationId: org.id, type: 'GROUNDED_TECHNICAL_ANSWER', input: { question: 'fixture' }, maxAttempts: 2 } })
  const pair = await Promise.all([actor(org.id), actor(org.id)])
  assert.equal(pair.filter(item => item.claim).length, 1, 'Only one process owns a claim')
  const first = pair.find(item => item.claim)!.claim!
  assert.equal(first.id, run.id)
  assert.equal(first.attemptCount, 1)
  assert.equal(await heartbeatWorkflow(first), true)
  assert.equal(await finalizeWorkflow(first, { status: 'RETRY_WAIT', errorMessage: 'temporary', nextAttemptAt: new Date(Date.now() + retryDelayMs(1)) }), true)
  assert.equal(await claimWorkflow({ organizationId: org.id }), null, 'Backoff prevents immediate reclaim')
  await prisma.workflowRun.update({ where: { id: run.id }, data: { nextAttemptAt: new Date(0) } })
  const second = await actor(org.id)
  assert.ok(second.claim)
  assert.equal(second.claim.leaseVersion, first.leaseVersion + 1)
  assert.equal(await finalizeWorkflow(first, { status: 'COMPLETED', output: { stale: true } }), false)
  assert.equal(await finalizeWorkflow(second.claim, { status: 'COMPLETED', output: { current: true } }), true)
  assert.deepEqual((await prisma.workflowRun.findUniqueOrThrow({ where: { id: run.id } })).output, { current: true })
  console.log('PASS two-process atomic claim, due backoff and stale-owner fencing')

  const interrupted = await prisma.workflowRun.create({ data: { organizationId: org.id, type: 'GROUNDED_TECHNICAL_ANSWER', input: { question: 'crash' }, maxAttempts: 2 } })
  const killed = await actor(org.id, true)
  assert.equal(killed.claim?.id, interrupted.id)
  killed.child.kill('SIGKILL')
  await once(killed.child, 'exit')
  await prisma.workflowRun.update({ where: { id: interrupted.id }, data: { leaseExpiresAt: new Date(0) } })
  const restarted = await actor(org.id)
  assert.equal(restarted.claim?.id, interrupted.id)
  assert.equal(restarted.claim?.attemptCount, 2)
  assert.equal(await finalizeWorkflow(killed.claim!, { status: 'COMPLETED', output: { stale: true } }), false)
  await prisma.workflowRun.update({ where: { id: interrupted.id }, data: { leaseExpiresAt: new Date(0) } })
  assert.equal(await claimWorkflow({ organizationId: org.id }), null)
  const exhausted = await prisma.workflowRun.findUniqueOrThrow({ where: { id: interrupted.id } })
  assert.equal(exhausted.status, 'FAILED')
  assert.equal(exhausted.attemptCount, 2)
  assert.ok(exhausted.completedAt)
  console.log('PASS killed owner, restart reclaim and terminal attempt bound')
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  await prisma.$disconnect()
}
