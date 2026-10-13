import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Workflow recovery requires a localhost sellora_test_* target')
}
Object.assign(process.env, { DATABASE_URL: target, NODE_ENV: 'test',
  EMBEDDING_PROVIDER: 'local', LOCAL_EMBEDDING_SERVICE_URL: 'http://127.0.0.1:1' })

const { prisma } = await import('../../src/config/prisma')
const { sha256Hex } = await import('../../src/utils/crypto')
const { claimWorkflow, finalizeWorkflow } = await import('../../src/modules/workflowRuns/workflowLease')
const { createApp } = await import('../../src/app')
let api: Server | undefined
let base = ''
const originalFetch = globalThis.fetch
let externalCalls = 0
globalThis.fetch = async (input, init) => {
  if (base && String(input).startsWith(`${base}/`)) return originalFetch(input, init)
  externalCalls++
  throw new Error('Unexpected provider dispatch in workflow recovery fixture')
}

try {
  const [org, other] = await Promise.all(['a', 'b'].map(suffix => prisma.organization.create({
    data: { name: `Workflow recovery ${suffix}`, slug: `workflow-recovery-${suffix}` },
  })))
  const user = await prisma.user.create({ data: { organizationId: org.id, role: 'ADMIN',
    email: 'workflow-recovery@test.invalid', passwordHash: await bcrypt.hash('FixturePassword1', 4),
    firstName: 'Workflow', lastName: 'Operator' } })
  const staffToken = jwt.sign({ sub: user.id, organizationId: org.id, email: user.email, role: user.role },
    process.env.JWT_ACCESS_SECRET!, { expiresIn: '10m' })
  const keys = await Promise.all([org, other].map(async (organization, index) => {
    const raw = `workflow-recovery-key-${index}`
    await prisma.apiKey.create({ data: { organizationId: organization.id, label: 'Fixture',
      scope: 'WEBHOOK_ONLY', keyHash: sha256Hex(raw), keyPrefix: 'fixture' } })
    return raw
  }))
  api = createServer(createApp()); api.listen(0, '127.0.0.1'); await once(api, 'listening')
  const address = api.address(); assert.ok(address && typeof address === 'object')
  base = `http://127.0.0.1:${address.port}`
  async function request(method: string, route: string, token: string, body?: unknown, key?: string) {
    const response = await fetch(`${base}/api/v1${route}`, { method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(key && { 'Idempotency-Key': key }) },
      ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
    })
    const json = await response.json() as { data: any; message: string }
    return { status: response.status, data: json.data, message: json.message }
  }
  const question = { source: 'MANUAL', payload: { question: 'the and', documentIds: [] } }
  const duplicates = await Promise.all(Array.from({ length: 12 }, () =>
    request('POST', '/webhooks/manual-question', keys[0]!, question, 'same-event')))
  assert.ok(duplicates.every(result => result.status === 202))
  const eventId = duplicates[0]!.data.webhookEventId
  const runId = duplicates[0]!.data.workflowRunId
  assert.ok(duplicates.every(result => result.data.webhookEventId === eventId && result.data.workflowRunId === runId))
  assert.equal(await prisma.webhookEvent.count({ where: { organizationId: org.id, idempotencyKey: 'same-event' } }), 1)
  assert.equal(await prisma.workflowRun.count({ where: { webhookEventId: eventId } }), 1)
  assert.equal(await prisma.workflowRunActivity.count({ where: { workflowRunId: runId, kind: 'RECEIVED' } }), 1)
  assert.equal((await request('POST', '/webhooks/manual-question', keys[0]!,
    { ...question, payload: { question: 'different' } }, 'same-event')).status, 409)
  assert.equal((await request('POST', '/webhooks/manual-question', keys[0]!,
    { ...question, source: 'GMAIL' }, 'same-event')).status, 202)
  assert.equal((await request('POST', '/webhooks/call-transcript', keys[0]!, question, 'same-event')).status, 202)
  const foreign = await request('POST', '/webhooks/manual-question', keys[1]!, question, 'same-event')
  assert.equal(foreign.status, 202)
  assert.notEqual(foreign.data.workflowRunId, runId)
  const externalEvent = { source: 'GMAIL', externalObjectType: 'EMAIL', externalObjectId: 'fixture-email-1',
    payload: { question: 'the and', documentIds: [] } }
  const naturalA = await request('POST', '/webhooks/manual-question', keys[0]!, externalEvent)
  const naturalB = await request('POST', '/webhooks/manual-question', keys[0]!, externalEvent)
  assert.equal(naturalA.data.workflowRunId, naturalB.data.workflowRunId)
  assert.equal((await request('POST', '/webhooks/manual-question', keys[0]!,
    { ...externalEvent, payload: { question: 'changed' } })).status, 409)
  console.log('PASS concurrent duplicate intake, mismatch conflict and organization/source/event scope')

  const processed = await Promise.all([request('POST', '/webhooks/manual-question?process=true', keys[0]!, question, 'process-once'),
    request('POST', '/webhooks/manual-question?process=true', keys[0]!, question, 'process-once')])
  assert.ok(processed.every(result => [200, 202].includes(result.status)))
  assert.equal(processed[0]!.data.workflowRunId, processed[1]!.data.workflowRunId)
  const processedId = processed[0]!.data.workflowRunId
  const completed = await prisma.workflowRun.findUniqueOrThrow({ where: { id: processedId } })
  assert.equal(completed.status, 'COMPLETED')
  assert.equal(completed.attemptCount, 1)
  assert.equal(await prisma.workflowRunActivity.count({ where: { workflowRunId: processedId, kind: 'COMPLETED' } }), 1)
  assert.equal(externalCalls, 0)
  console.log('PASS concurrent process request yields one durable result and zero external dispatch')

  const cancelled = await request('POST', `/workflow-runs/${runId}/cancel`, staffToken, {})
  assert.equal(cancelled.status, 200)
  assert.equal(cancelled.data.status, 'CANCELLED')
  assert.equal((await request('POST', `/workflow-runs/${runId}/retry`, staffToken, {})).status, 409)
  assert.equal((await request('POST', `/workflow-runs/${runId}/process`, staffToken, {})).status, 409)
  assert.equal((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: eventId } })).status, 'IGNORED')
  const running = await prisma.workflowRun.create({ data: { organizationId: org.id,
    type: 'GROUNDED_TECHNICAL_ANSWER', input: { question: 'the and', documentIds: [] } } })
  const claim = await claimWorkflow({ organizationId: org.id, workflowRunId: running.id })
  assert.ok(claim)
  assert.equal((await request('POST', `/workflow-runs/${running.id}/cancel`, staffToken, {})).status, 200)
  assert.equal(await finalizeWorkflow(claim, { status: 'COMPLETED', output: { stale: true } }), false)
  assert.equal((await prisma.workflowRun.findUniqueOrThrow({ where: { id: running.id } })).status, 'CANCELLED')
  assert.equal((await request('GET', `/workflow-runs/${foreign.data.workflowRunId}`, staffToken)).status, 404)
  assert.equal((await request('POST', `/workflow-runs/${foreign.data.workflowRunId}/cancel`, staffToken, {})).status, 404)
  assert.equal((await request('POST', `/workflow-runs/${foreign.data.workflowRunId}/retry`, staffToken, {})).status, 404)
  console.log('PASS scoped cancel fences running owner and terminal cancellation cannot resurrect')

  const failed = await prisma.workflowRun.create({ data: { organizationId: org.id,
    type: 'GROUNDED_TECHNICAL_ANSWER', status: 'FAILED',
    input: { question: 'the and', documentIds: [] }, startedAt: new Date(), completedAt: new Date(),
    attemptCount: 3, errorMessage: 'Original failure',
    output: { kind: 'GROUNDED_ANSWER_PARTIAL', result: completed.output as object },
  } })
  const retry = await request('POST', `/workflow-runs/${failed.id}/retry`, staffToken, {})
  assert.equal(retry.status, 200)
  assert.equal(retry.data.status, 'QUEUED')
  assert.equal(retry.data.attemptCount, 0)
  assert.equal((await request('POST', `/workflow-runs/${failed.id}/process`, staffToken, {})).status, 200)
  const resumed = await prisma.workflowRun.findUniqueOrThrow({ where: { id: failed.id } })
  assert.equal(resumed.status, 'COMPLETED')
  assert.deepEqual(resumed.output, completed.output)
  assert.equal(await prisma.workflowRunActivity.count({ where: { workflowRunId: failed.id, kind: 'RETRIED' } }), 1)
  assert.equal(externalCalls, 0)
  console.log('PASS manual retry preserves checkpoint and resumes without another provider call')

  const waiting = await prisma.workflowRun.create({ data: { organizationId: org.id,
    type: 'GROUNDED_TECHNICAL_ANSWER', status: 'RETRY_WAIT', input: { question: 'the and' },
    startedAt: new Date(), attemptCount: 1, errorMessage: 'Temporary',
    nextAttemptAt: new Date(Date.now() + 60_000) } })
  const raced = await Promise.all([request('POST', `/workflow-runs/${waiting.id}/retry`, staffToken, {}),
    request('POST', `/workflow-runs/${waiting.id}/cancel`, staffToken, {})])
  assert.ok(raced.every(result => [200, 409].includes(result.status)))
  assert.ok(raced.some(result => result.status === 200))
  const raceStatus = (await prisma.workflowRun.findUniqueOrThrow({ where: { id: waiting.id } })).status
  assert.equal(raceStatus, raced[1]!.status === 200 ? 'CANCELLED' : 'QUEUED')
  if (raceStatus === 'QUEUED') {
    assert.equal((await request('POST', `/workflow-runs/${waiting.id}/cancel`, staffToken, {})).status, 200)
  }
  assert.equal((await prisma.workflowRun.findUniqueOrThrow({ where: { id: waiting.id } })).status, 'CANCELLED')
  assert.equal((await request('POST', `/workflow-runs/${waiting.id}/retry`, staffToken, {})).status, 409)
  console.log('PASS retry/cancel race cannot resurrect terminal cancellation')
} finally {
  globalThis.fetch = originalFetch
  if (api) { api.closeAllConnections(); await new Promise<void>(resolve => api!.close(() => resolve())) }
  await prisma.$disconnect()
}
