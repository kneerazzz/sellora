import type { Prisma, WorkloadMeasurementStatus } from '@prisma/client'
import { env } from '../../config/env'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { randomUUID } from 'node:crypto'
import { ProviderOperationError } from '../../services/provider/providerTransport'
import { createUsageTrace, finalizeUsageTrace } from './usageLedger.service'

export type WorkloadLimits = {
  maxConcurrent: number
  maxPeriodUnits: number
  periodMs: number
  reservationTtlMs: number
}

export const defaultWorkloadLimits: WorkloadLimits = {
  maxConcurrent: env.PROVIDER_CONCURRENCY_MAX,
  maxPeriodUnits: env.PROVIDER_PERIOD_UNITS_MAX,
  periodMs: env.PROVIDER_PERIOD_SECONDS * 1_000,
  reservationTtlMs: env.PROVIDER_RESERVATION_TTL_SECONDS * 1_000,
}

export class WorkloadAdmissionError extends ApiError {
  constructor(
    message: string,
    public readonly reason: 'concurrency' | 'allowance' | 'idempotency' | 'paused'
  ) {
    super(reason === 'idempotency' ? 409 : reason === 'paused' ? 403 : 429, message)
    Object.setPrototypeOf(this, WorkloadAdmissionError.prototype)
  }
}

type ReservationClient = Prisma.TransactionClient

async function lockOrganization(tx: ReservationClient, organizationId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0)) IS NULL AS locked`
}

export async function reserveWorkload(params: {
  organizationId: string
  reservationKey: string
  operation: string
  units: number
  now?: Date
  limits?: WorkloadLimits
}) {
  if (!Number.isSafeInteger(params.units) || params.units <= 0) {
    throw ApiError.badRequest('Workload reservation units must be a positive integer')
  }
  const now = params.now ?? new Date()
  const limits = params.limits ?? defaultWorkloadLimits

  try {
    return await prisma.$transaction(async tx => {
    await lockOrganization(tx, params.organizationId)
    const control = await tx.organizationUsageControl.findUnique({ where: { organizationId: params.organizationId } })
    if (control?.paused) throw new WorkloadAdmissionError('Organization provider work is paused', 'paused')
    await tx.workloadReservation.updateMany({
      where: { organizationId: params.organizationId, status: 'RESERVED', expiresAt: { lte: now } },
      data: { status: 'ABANDONED', completedAt: now, measurementStatus: 'UNKNOWN' },
    })

    const existing = await tx.workloadReservation.findUnique({
      where: { organizationId_reservationKey: {
        organizationId: params.organizationId,
        reservationKey: params.reservationKey,
      } },
    })
    if (existing) {
      if (existing.operation === params.operation && existing.reservedUnits === params.units && existing.status === 'RESERVED') {
        return existing
      }
      throw new WorkloadAdmissionError('Reservation key was already used for different or completed work', 'idempotency')
    }

    const periodStart = new Date(now.getTime() - limits.periodMs)
    const [usage] = await tx.$queryRaw<Array<{ active: bigint; used: bigint }>>`
      SELECT
        count(*) FILTER (WHERE "status" = 'RESERVED')::bigint AS active,
        COALESCE(sum(CASE
          WHEN "createdAt" < ${periodStart} THEN 0
          WHEN "status" = 'RELEASED' THEN 0
          WHEN "status" = 'RECONCILED' AND "actualUnits" IS NOT NULL THEN "actualUnits"
          ELSE "reservedUnits"
        END), 0)::bigint AS used
      FROM "workload_reservations"
      WHERE "organizationId" = ${params.organizationId}
    `
    if (Number(usage!.active) >= limits.maxConcurrent) {
      throw new WorkloadAdmissionError('Organization provider concurrency limit reached', 'concurrency')
    }
    if (Number(usage!.used) + params.units > limits.maxPeriodUnits) {
      throw new WorkloadAdmissionError('Organization provider allowance exhausted', 'allowance')
    }

    return tx.workloadReservation.create({
      data: {
        organizationId: params.organizationId,
        reservationKey: params.reservationKey,
        operation: params.operation,
        reservedUnits: params.units,
        expiresAt: new Date(now.getTime() + limits.reservationTtlMs),
      },
    })
    })
  } catch (error) {
    if (error instanceof WorkloadAdmissionError && error.reason === 'allowance') {
      const periodKey = Math.floor(now.getTime() / limits.periodMs)
      const dedupeKey = `allowance:${periodKey}`
      await prisma.usageAlertEvent.upsert({
        where: { organizationId_dedupeKey: { organizationId: params.organizationId, dedupeKey } },
        create: { organizationId: params.organizationId, kind: 'ALLOWANCE_EXHAUSTED', dedupeKey },
        update: {},
      }).catch((alertError: unknown) => console.error('Failed to record usage alert event', alertError))
    }
    throw error
  }
}

export async function releaseWorkload(reservationId: string, now = new Date()) {
  const updated = await prisma.workloadReservation.updateMany({
    where: { id: reservationId, status: 'RESERVED' },
    data: { status: 'RELEASED', actualUnits: 0, measurementStatus: 'MEASURED', completedAt: now },
  })
  if (updated.count !== 1) throw ApiError.conflict('Workload reservation is no longer active')
}

export async function reconcileWorkload(params: {
  reservationId: string
  actualUnits: number | null
  measurementStatus: WorkloadMeasurementStatus
  now?: Date
}) {
  if (params.actualUnits !== null && (!Number.isSafeInteger(params.actualUnits) || params.actualUnits < 0)) {
    throw ApiError.badRequest('Actual workload units must be a nonnegative integer or unknown')
  }
  if (params.measurementStatus === 'UNKNOWN' && params.actualUnits !== null) {
    throw ApiError.badRequest('Unknown workload usage must remain null')
  }
  if (params.measurementStatus !== 'UNKNOWN' && params.actualUnits === null) {
    throw ApiError.badRequest('Measured or estimated workload usage requires units')
  }
  const updated = await prisma.workloadReservation.updateMany({
    where: { id: params.reservationId, status: { in: ['RESERVED', 'ABANDONED'] } },
    data: {
      status: 'RECONCILED',
      actualUnits: params.actualUnits,
      measurementStatus: params.measurementStatus,
      completedAt: params.now ?? new Date(),
    },
  })
  if (updated.count !== 1) throw ApiError.conflict('Workload reservation was already finalized')
}

export async function withWorkloadReservation<T>(params: {
  organizationId: string
  operation: string
  units: number
  reservationKey?: string
  requestId?: string
  workflowRunId?: string
  work: (control: { markAttempted: () => void; markRefused: () => void; usageTraceId: string }) => Promise<T>
}): Promise<T> {
  const reservation = await reserveWorkload({
    organizationId: params.organizationId,
    reservationKey: params.reservationKey ?? randomUUID(),
    operation: params.operation,
    units: params.units,
  })
  let attempted = false
  let refused = false
  let trace
  try {
    trace = await createUsageTrace({
      organizationId: params.organizationId,
      operation: params.operation,
      requestId: params.requestId,
      workflowRunId: params.workflowRunId,
      reservationId: reservation.id,
    })
  } catch (error) {
    await releaseWorkload(reservation.id).catch(() => undefined)
    throw error
  }

  try {
    const result = await params.work({
      markAttempted: () => { attempted = true },
      markRefused: () => { refused = true },
      usageTraceId: trace.id,
    })
    await reconcileWorkload({
      reservationId: reservation.id,
      actualUnits: params.units,
      measurementStatus: 'ESTIMATED',
    })
    await finalizeUsageTrace({ traceId: trace.id, status: refused ? 'REFUSED' : 'COMPLETED' })
    return result
  } catch (error) {
    try {
      if (attempted) {
        await reconcileWorkload({
          reservationId: reservation.id,
          actualUnits: null,
          measurementStatus: 'UNKNOWN',
        })
      } else {
        await releaseWorkload(reservation.id)
      }
    } catch (finalizationError) {
      console.error('Failed to finalize workload reservation; it remains conservatively reserved', finalizationError)
    }
    await finalizeUsageTrace({
      traceId: trace.id,
      status: error instanceof ProviderOperationError && error.category === 'cancelled' ? 'CANCELLED' : 'FAILED',
      errorCategory: error instanceof ProviderOperationError ? error.category : 'application',
    }).catch(finalizationError => {
      console.error('Failed to finalize usage trace', finalizationError)
    })
    throw error
  }
}
