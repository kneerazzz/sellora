import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Usage ledger harness requires a localhost sellora_test_* target')
}
Object.assign(process.env, { DATABASE_URL: target, NODE_ENV: 'test' })

const { prisma } = await import('../../src/config/prisma')
const { requestProviderJson } = await import('../../src/services/provider/providerTransport')
const { withWorkloadReservation } = await import('../../src/modules/usage/workloadReservations.service')
const {
  createUsageAttemptObserver, createUsageTrace, finalizeUsageAttempt, finalizeUsageTrace,
  recordStandaloneUsage, recordUsageQuantities, startUsageAttempt, withUsageTrace,
} = await import('../../src/modules/usage/usageLedger.service')

const policy = { timeoutMs: 5_000, maxAttempts: 2, baseRetryDelayMs: 0, maxRetryDelayMs: 0 }

try {
  const organization = await prisma.organization.create({ data: { name: 'Usage ledger fixture', slug: 'usage-ledger-fixture' } })
  const requestId = randomUUID()
  let dispatches = 0
  await withWorkloadReservation({
    organizationId: organization.id, operation: 'ledger-success', units: 10, requestId,
    work: async ({ markAttempted, usageTraceId }) => {
      markAttempted()
      const result = await requestProviderJson({
        url: 'https://provider.invalid', request: {}, validate: value => value,
        options: {
          policy,
          attemptObserver: createUsageAttemptObserver({
            traceId: usageTraceId, component: 'generation', category: 'PROVIDER', provider: 'fixture', model: 'fixture-v1',
          }),
          dependencies: { fetch: async () => {
            dispatches += 1
            return dispatches === 1 ? Response.json({ error: {} }, { status: 503 }) : Response.json({ ok: true })
          } },
        },
      })
      await recordUsageQuantities({
        traceId: usageTraceId, component: 'generation', attemptNumber: result.attempts.at(-1)!.attempt,
        inputQuantity: 7, outputQuantity: 3, totalQuantity: 10, unitType: 'TOKENS', measurementStatus: 'MEASURED',
      })
    },
  })
  const success = await prisma.usageTrace.findFirstOrThrow({ where: { organizationId: organization.id, requestId },
    include: { attempts: { orderBy: { attemptNumber: 'asc' } }, reservation: true } })
  assert.equal(success.status, 'COMPLETED')
  assert.equal(success.rateVersion, 'unpriced-v1')
  assert.equal(success.currency, null)
  assert.equal(success.attempts.length, 2)
  assert.deepEqual(success.attempts.map(row => [row.status, row.measurementStatus, row.totalQuantity]), [
    ['FAILED', 'UNKNOWN', null], ['SUCCEEDED', 'MEASURED', 10],
  ])
  assert.equal(success.reservation?.status, 'RECONCILED')
  assert.equal(success.reservation?.actualUnits, 10)
  assert.equal(success.attempts.reduce((sum, row) => sum + (row.totalQuantity ?? 0), 0), 10)
  console.log('PASS request-correlated retry trace records every attempt and measured success once')

  const refusedRequestId = randomUUID()
  await withUsageTrace({
    organizationId: organization.id, operation: 'grounded_answer', requestId: refusedRequestId,
    work: async ({ markRefused }) => { markRefused(); return 'refused' },
  })
  const refused = await prisma.usageTrace.findFirstOrThrow({ where: { requestId: refusedRequestId }, include: { attempts: true } })
  assert.equal(refused.status, 'REFUSED')
  assert.equal(refused.attempts.length, 0)

  const workflowRun = await prisma.workflowRun.create({ data: {
    organizationId: organization.id, type: 'SALES_EVENT_EXTRACTION', input: { content: 'fixture' },
  } })
  await assert.rejects(withWorkloadReservation({
    organizationId: organization.id, operation: 'ledger-failure', units: 5, workflowRunId: workflowRun.id,
    work: async ({ markAttempted, usageTraceId }) => {
      markAttempted()
      await requestProviderJson({
        url: 'https://provider.invalid', request: {}, validate: value => value,
        options: {
          policy: { ...policy, maxAttempts: 1 },
          attemptObserver: createUsageAttemptObserver({
            traceId: usageTraceId, component: 'generation', category: 'PROVIDER', provider: 'fixture', model: 'fixture-v1',
          }),
          dependencies: { fetch: async () => Response.json({ error: {} }, { status: 503 }) },
        },
      })
    },
  }))
  const failed = await prisma.usageTrace.findFirstOrThrow({ where: { workflowRunId: workflowRun.id, operation: 'ledger-failure' },
    include: { attempts: true, reservation: true } })
  assert.equal(failed.status, 'FAILED')
  assert.equal(failed.attempts[0]?.status, 'FAILED')
  assert.equal(failed.attempts[0]?.totalQuantity, null)
  assert.equal(failed.reservation?.measurementStatus, 'UNKNOWN')

  const cancellationRun = await prisma.workflowRun.create({ data: {
    organizationId: organization.id, type: 'GROUNDED_TECHNICAL_ANSWER', input: { question: 'fixture' },
  } })
  const controller = new AbortController()
  let signalDispatched!: () => void
  const dispatched = new Promise<void>(resolve => { signalDispatched = resolve })
  const cancellation = withWorkloadReservation({
    organizationId: organization.id, operation: 'ledger-cancellation', units: 5, workflowRunId: cancellationRun.id,
    work: async ({ markAttempted, usageTraceId }) => {
      markAttempted()
      await requestProviderJson({
        url: 'https://provider.invalid', request: {}, validate: value => value,
        options: {
          policy, signal: controller.signal,
          attemptObserver: createUsageAttemptObserver({
            traceId: usageTraceId, component: 'generation', category: 'PROVIDER', provider: 'fixture', model: 'fixture-v1',
          }),
          dependencies: { fetch: async (_input, init) => new Promise((_resolve, reject) => {
            signalDispatched()
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
          }) },
        },
      })
    },
  })
  await dispatched
  controller.abort()
  await assert.rejects(cancellation)
  const cancelled = await prisma.usageTrace.findFirstOrThrow({ where: { workflowRunId: cancellationRun.id }, include: { attempts: true } })
  assert.equal(cancelled.status, 'CANCELLED')
  assert.equal(cancelled.attempts[0]?.status, 'CANCELLED')
  assert.equal(cancelled.attempts[0]?.measurementStatus, 'UNKNOWN')
  console.log('PASS refused, failed and interrupted traces preserve zero-or-all attempts and unknown quantities')

  const idempotent = await createUsageTrace({ organizationId: organization.id, operation: 'idempotent-finalize' })
  const startedAtMs = Date.now()
  await startUsageAttempt({ traceId: idempotent.id, component: 'fixture', attemptNumber: 1,
    category: 'LOCAL_COMPUTE', startedAt: new Date(startedAtMs) })
  const outcome = { attempt: 1, startedAtMs, endedAtMs: startedAtMs + 2, elapsedMs: 2,
    outcome: 'success' as const, retryable: false, cancellation: 'wait_only' as const }
  await finalizeUsageAttempt({ traceId: idempotent.id, component: 'fixture', outcome })
  await finalizeUsageAttempt({ traceId: idempotent.id, component: 'fixture', outcome })
  await assert.rejects(finalizeUsageAttempt({ traceId: idempotent.id, component: 'fixture', outcome: {
    ...outcome, elapsedMs: 3,
  } }), (error: any) => error.statusCode === 409)
  await finalizeUsageTrace({ traceId: idempotent.id, status: 'COMPLETED' })
  await finalizeUsageTrace({ traceId: idempotent.id, status: 'COMPLETED' })
  await assert.rejects(finalizeUsageTrace({ traceId: idempotent.id, status: 'FAILED' }), (error: any) => error.statusCode === 409)

  for (const category of ['LOCAL_COMPUTE', 'STORAGE', 'INFRASTRUCTURE', 'AUTOMATION', 'HUMAN_SUPPORT'] as const) {
    await recordStandaloneUsage({
      organizationId: organization.id, operation: `category-${category.toLowerCase()}`,
      component: 'fixture', category, quantity: 1, unitType: 'ITEMS', measurementStatus: 'ESTIMATED',
    })
  }
  const categories = await prisma.usageAttempt.groupBy({ by: ['category'], where: { trace: { organizationId: organization.id } } })
  assert.deepEqual(new Set(categories.map(row => row.category)),
    new Set(['PROVIDER', 'LOCAL_COMPUTE', 'STORAGE', 'INFRASTRUCTURE', 'AUTOMATION', 'HUMAN_SUPPORT']))
  console.log('PASS idempotent completion and separate provider/local/storage/infrastructure/automation/support categories')
} finally {
  await prisma.$disconnect()
}
