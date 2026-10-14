import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Local test target required')
}
Object.assign(process.env, { DATABASE_URL: target, NODE_ENV: 'test' })

const { prisma } = await import('../../src/config/prisma')
const { reconcileWorkload, releaseWorkload, reserveWorkload, withWorkloadReservation, WorkloadAdmissionError } = await import('../../src/modules/usage/workloadReservations.service')
const { getUsageSummary, setUsagePause } = await import('../../src/modules/usage/usageControls.service')
const exec = promisify(execFile)

async function child(organizationId: string, limits: { concurrency: number; allowance: number }, attempts = 4) {
  const result = await exec(process.execPath, ['--import', 'tsx', 'scripts/integration/reservationProcess.ts'], {
    env: {
      ...process.env,
      SELLORA_RESERVATION_ORGANIZATION_ID: organizationId,
      SELLORA_RESERVATION_ATTEMPTS: String(attempts),
      SELLORA_RESERVATION_UNITS: '1',
      PROVIDER_CONCURRENCY_MAX: String(limits.concurrency),
      PROVIDER_PERIOD_UNITS_MAX: String(limits.allowance),
      PROVIDER_PERIOD_SECONDS: '3600',
      PROVIDER_RESERVATION_TTL_SECONDS: '120',
    },
    timeout: 30_000,
  })
  const jsonLine = result.stdout.trim().split('\n').reverse().find((line: string) => line.trim().startsWith('{'))
  if (!jsonLine) throw new Error('Reservation child produced no JSON result')
  return JSON.parse(jsonLine) as { admitted: number; denied: Record<string, number> }
}

try {
  const concurrentOrg = await prisma.organization.create({ data: { name: 'Reservations concurrency', slug: 'reservations-concurrency' } })
  const pair = await Promise.all([child(concurrentOrg.id, { concurrency: 3, allowance: 100 }), child(concurrentOrg.id, { concurrency: 3, allowance: 100 })])
  assert.equal(pair.reduce((sum, result) => sum + result.admitted, 0), 3)
  assert.equal((await child(concurrentOrg.id, { concurrency: 3, allowance: 100 }, 1)).admitted, 0, 'Restart cannot bypass active concurrency')
  assert.equal(await prisma.workloadReservation.count({ where: { organizationId: concurrentOrg.id, status: 'RESERVED' } }), 3)

  await prisma.workloadReservation.updateMany({ where: { organizationId: concurrentOrg.id }, data: { expiresAt: new Date(0) } })
  assert.equal((await child(concurrentOrg.id, { concurrency: 3, allowance: 100 }, 4)).admitted, 3)
  assert.equal(await prisma.workloadReservation.count({ where: { organizationId: concurrentOrg.id, status: 'ABANDONED', measurementStatus: 'UNKNOWN' } }), 3)
  console.log('PASS atomic reservation concurrency across two processes, restart and abandoned recovery')

  const allowanceOrg = await prisma.organization.create({ data: { name: 'Reservations allowance', slug: 'reservations-allowance' } })
  const allowancePair = await Promise.all([child(allowanceOrg.id, { concurrency: 100, allowance: 5 }), child(allowanceOrg.id, { concurrency: 100, allowance: 5 })])
  assert.equal(allowancePair.reduce((sum, result) => sum + result.admitted, 0), 5)
  assert.equal((await child(allowanceOrg.id, { concurrency: 100, allowance: 5 }, 1)).admitted, 0)

  const reservations = await prisma.workloadReservation.findMany({ where: { organizationId: allowanceOrg.id }, orderBy: { createdAt: 'asc' } })
  await releaseWorkload(reservations[0]!.id)
  assert.equal((await child(allowanceOrg.id, { concurrency: 100, allowance: 5 }, 1)).admitted, 1, 'Released unused units become available')
  await reconcileWorkload({ reservationId: reservations[1]!.id, actualUnits: null, measurementStatus: 'UNKNOWN' })
  const unknown = await prisma.workloadReservation.findUniqueOrThrow({ where: { id: reservations[1]!.id } })
  assert.equal(unknown.actualUnits, null)
  assert.equal((await child(allowanceOrg.id, { concurrency: 100, allowance: 5 }, 1)).admitted, 0, 'Unknown usage remains conservatively charged')
  await assert.rejects(
    reconcileWorkload({ reservationId: reservations[1]!.id, actualUnits: 0, measurementStatus: 'MEASURED' }),
    (error: any) => error.statusCode === 409
  )
  console.log('PASS period allowance, release, unknown reconciliation and finalize-once behavior')

  const isolatedOrg = await prisma.organization.create({ data: { name: 'Reservations isolated', slug: 'reservations-isolated' } })
  const isolated = await reserveWorkload({
    organizationId: isolatedOrg.id,
    reservationKey: 'isolated-one',
    operation: 'integration-fixture',
    units: 1,
    limits: { maxConcurrent: 1, maxPeriodUnits: 1, periodMs: 3_600_000, reservationTtlMs: 120_000 },
  })
  assert.equal(isolated.organizationId, isolatedOrg.id)
  await assert.rejects(
    reserveWorkload({
      organizationId: isolatedOrg.id,
      reservationKey: 'isolated-two',
      operation: 'integration-fixture',
      units: 1,
      limits: { maxConcurrent: 1, maxPeriodUnits: 1, periodMs: 3_600_000, reservationTtlMs: 120_000 },
    }),
    (error: any) => error instanceof WorkloadAdmissionError && error.reason === 'concurrency'
  )
  assert.equal(await prisma.workloadReservation.count({ where: { organizationId: concurrentOrg.id } }), 6)
  console.log('PASS organization isolation and denial before additional admission')

  const lifecycleOrg = await prisma.organization.create({ data: { name: 'Reservation lifecycle', slug: 'reservation-lifecycle' } })
  let workStarts = 0
  await assert.rejects(withWorkloadReservation({
    organizationId: lifecycleOrg.id, operation: 'pre-attempt', units: 2,
    work: async () => { workStarts += 1; throw new Error('failed before provider dispatch') },
  }))
  await assert.rejects(withWorkloadReservation({
    organizationId: lifecycleOrg.id, operation: 'attempted', units: 3,
    work: async ({ markAttempted }) => { workStarts += 1; markAttempted(); throw new Error('provider outcome unknown') },
  }))
  assert.equal(await withWorkloadReservation({
    organizationId: lifecycleOrg.id, operation: 'successful', units: 4,
    work: async ({ markAttempted }) => { workStarts += 1; markAttempted(); return 'ok' },
  }), 'ok')
  const lifecycle = await prisma.workloadReservation.findMany({ where: { organizationId: lifecycleOrg.id }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(lifecycle.map(row => [row.status, row.actualUnits, row.measurementStatus]), [
    ['RELEASED', 0, 'MEASURED'],
    ['RECONCILED', null, 'UNKNOWN'],
    ['RECONCILED', 4, 'ESTIMATED'],
  ])
  const blocker = await reserveWorkload({
    organizationId: lifecycleOrg.id, reservationKey: 'lifecycle-blocker', operation: 'blocker', units: 999_993,
  })
  await assert.rejects(withWorkloadReservation({
    organizationId: lifecycleOrg.id, operation: 'denied', units: 1,
    work: async () => { workStarts += 1 },
  }), (error: any) => error instanceof WorkloadAdmissionError)
  assert.equal(workStarts, 3, 'Admission denial cannot begin work')
  await releaseWorkload(blocker.id)
  console.log('PASS unused, attempted-unknown, success and denial-before-work lifecycle accounting')

  await setUsagePause(lifecycleOrg.id, 'fixture-admin', true)
  const paused = await Promise.all([child(lifecycleOrg.id, { concurrency: 4, allowance: 1_000_000 }, 1),
    child(lifecycleOrg.id, { concurrency: 4, allowance: 1_000_000 }, 1)])
  assert.equal(paused.reduce((sum, result) => sum + result.admitted, 0), 0)
  assert.ok(paused.every(result => result.denied.paused === 1))
  assert.equal((await getUsageSummary(lifecycleOrg.id)).paused, true)
  await setUsagePause(lifecycleOrg.id, 'fixture-admin', false)
  const resumed = await child(lifecycleOrg.id, { concurrency: 4, allowance: 1_000_000 }, 1)
  assert.equal(resumed.admitted, 1)
  console.log('PASS persistent pause across two processes, restart and resumed admission')
} finally {
  await prisma.$disconnect()
}
