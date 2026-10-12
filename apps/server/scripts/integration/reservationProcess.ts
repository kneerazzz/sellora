import { randomUUID } from 'node:crypto'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
const organizationId = process.env.SELLORA_RESERVATION_ORGANIZATION_ID
const attempts = Number(process.env.SELLORA_RESERVATION_ATTEMPTS ?? '1')
const units = Number(process.env.SELLORA_RESERVATION_UNITS ?? '1')
if (!target || !organizationId || !Number.isSafeInteger(attempts) || attempts < 1) {
  throw new Error('Explicit disposable reservation process inputs required')
}
Object.assign(process.env, { DATABASE_URL: target, NODE_ENV: 'test' })

const { prisma } = await import('../../src/config/prisma')
const { reserveWorkload, WorkloadAdmissionError } = await import('../../src/modules/usage/workloadReservations.service')
let admitted = 0
const denied: Record<string, number> = {}

try {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await reserveWorkload({
        organizationId,
        reservationKey: `${process.pid}-${randomUUID()}-${index}`,
        operation: 'integration-fixture',
        units,
      })
      admitted += 1
    } catch (error) {
      if (!(error instanceof WorkloadAdmissionError)) throw error
      denied[error.reason] = (denied[error.reason] ?? 0) + 1
    }
  }
  process.stdout.write(JSON.stringify({ admitted, denied }))
} finally {
  await prisma.$disconnect()
}
