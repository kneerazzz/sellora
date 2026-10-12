import type {
  UsageAttemptStatus,
  UsageCostCategory,
  UsageTraceStatus,
  UsageUnitType,
  WorkloadMeasurementStatus,
} from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import type { ProviderAttemptObserver, ProviderAttemptOutcome } from '../../services/provider/providerTransport'
import { randomUUID } from 'node:crypto'

export type UsageCorrelation = {
  organizationId: string
  requestId?: string
  workflowRunId?: string
}

export type UsageAttemptContext = {
  traceId: string
  component: string
  category: UsageCostCategory
  provider?: string
  model?: string
  rateVersion?: string
  currency?: string
}

const attemptStatus = (outcome: ProviderAttemptOutcome): UsageAttemptStatus =>
  outcome.outcome === 'success' ? 'SUCCEEDED'
    : outcome.outcome === 'cancelled' ? 'CANCELLED'
      : outcome.outcome === 'deadline_exceeded' ? 'DEADLINE_EXCEEDED' : 'FAILED'

export async function createUsageTrace(params: UsageCorrelation & {
  operation: string
  reservationId?: string
  rateVersion?: string
  currency?: string
}) {
  return prisma.usageTrace.create({ data: {
    organizationId: params.organizationId,
    operation: params.operation,
    requestId: params.requestId ?? (params.workflowRunId ? undefined : randomUUID()),
    workflowRunId: params.workflowRunId,
    reservationId: params.reservationId,
    rateVersion: params.rateVersion ?? 'unpriced-v1',
    currency: params.currency,
  } })
}

export async function finalizeUsageTrace(params: {
  traceId: string
  status: Exclude<UsageTraceStatus, 'RUNNING'>
  errorCategory?: string
  completedAt?: Date
}) {
  const completedAt = params.completedAt ?? new Date()
  const trace = await prisma.usageTrace.findUnique({ where: { id: params.traceId } })
  if (!trace) throw ApiError.notFound('Usage trace not found')
  const elapsedMs = Math.max(0, completedAt.getTime() - trace.startedAt.getTime())
  const updated = await prisma.usageTrace.updateMany({
    where: { id: params.traceId, status: 'RUNNING' },
    data: { status: params.status, errorCategory: params.errorCategory, completedAt, elapsedMs },
  })
  if (updated.count === 1) return
  const existing = await prisma.usageTrace.findUniqueOrThrow({ where: { id: params.traceId } })
  if (existing.status === params.status && existing.errorCategory === (params.errorCategory ?? null)) return
  throw ApiError.conflict('Usage trace was already finalized differently')
}

export async function startUsageAttempt(params: UsageAttemptContext & {
  attemptNumber: number
  startedAt: Date
}) {
  try {
    return await prisma.usageAttempt.create({ data: {
      traceId: params.traceId,
      component: params.component,
      attemptNumber: params.attemptNumber,
      category: params.category,
      provider: params.provider,
      model: params.model,
      startedAt: params.startedAt,
      rateVersion: params.rateVersion ?? 'unpriced-v1',
      currency: params.currency,
    } })
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error
    const existing = await prisma.usageAttempt.findUniqueOrThrow({ where: { traceId_component_attemptNumber: {
      traceId: params.traceId, component: params.component, attemptNumber: params.attemptNumber,
    } } })
    if (existing.category !== params.category || existing.provider !== (params.provider ?? null) ||
      existing.model !== (params.model ?? null) || existing.startedAt.getTime() !== params.startedAt.getTime()) {
      throw ApiError.conflict('Usage attempt was already started differently')
    }
    return existing
  }
}

export async function finalizeUsageAttempt(params: {
  traceId: string
  component: string
  outcome: ProviderAttemptOutcome
}) {
  const status = attemptStatus(params.outcome)
  const key = { traceId: params.traceId, component: params.component, attemptNumber: params.outcome.attempt }
  const updated = await prisma.usageAttempt.updateMany({
    where: { ...key, status: 'STARTED' },
    data: {
      status,
      errorCategory: params.outcome.category,
      httpStatus: params.outcome.statusCode,
      retryable: params.outcome.retryable,
      cancellationMode: params.outcome.cancellation,
      completedAt: new Date(params.outcome.endedAtMs),
      elapsedMs: params.outcome.elapsedMs,
    },
  })
  if (updated.count === 1) return
  const existing = await prisma.usageAttempt.findUnique({ where: { traceId_component_attemptNumber: key } })
  if (existing?.status === status && existing.errorCategory === (params.outcome.category ?? null) &&
    existing.httpStatus === (params.outcome.statusCode ?? null) &&
    existing.retryable === params.outcome.retryable &&
    existing.cancellationMode === params.outcome.cancellation &&
    existing.completedAt?.getTime() === params.outcome.endedAtMs &&
    existing.elapsedMs === params.outcome.elapsedMs) return
  throw ApiError.conflict('Usage attempt was already finalized differently')
}

export async function recordUsageQuantities(params: {
  traceId: string
  component: string
  attemptNumber: number
  inputQuantity: number | null
  outputQuantity: number | null
  totalQuantity: number | null
  unitType: UsageUnitType
  measurementStatus: WorkloadMeasurementStatus
}) {
  const quantities = [params.inputQuantity, params.outputQuantity, params.totalQuantity]
  if (params.measurementStatus === 'UNKNOWN' && quantities.some(value => value !== null)) {
    throw ApiError.badRequest('Unknown usage quantities must remain null')
  }
  if (params.measurementStatus !== 'UNKNOWN' && quantities.some(value => value === null)) {
    throw ApiError.badRequest('Measured or estimated usage requires all quantities')
  }
  if (quantities.some(value => value !== null && (!Number.isSafeInteger(value) || value < 0))) {
    throw ApiError.badRequest('Usage quantities must be nonnegative safe integers')
  }
  const key = { traceId: params.traceId, component: params.component, attemptNumber: params.attemptNumber }
  const updated = await prisma.usageAttempt.updateMany({
    where: { ...key, status: 'SUCCEEDED', measurementStatus: 'UNKNOWN', inputQuantity: null, outputQuantity: null, totalQuantity: null },
    data: {
      inputQuantity: params.inputQuantity,
      outputQuantity: params.outputQuantity,
      totalQuantity: params.totalQuantity,
      unitType: params.unitType,
      measurementStatus: params.measurementStatus,
    },
  })
  if (updated.count === 1) return
  const existing = await prisma.usageAttempt.findUnique({ where: { traceId_component_attemptNumber: key } })
  if (existing && existing.measurementStatus === params.measurementStatus &&
    existing.inputQuantity === params.inputQuantity && existing.outputQuantity === params.outputQuantity &&
    existing.totalQuantity === params.totalQuantity && existing.unitType === params.unitType) return
  throw ApiError.conflict('Usage quantities were already recorded differently')
}

export function createUsageAttemptObserver(context: UsageAttemptContext): ProviderAttemptObserver {
  return {
    async beforeAttempt(event) {
      await startUsageAttempt({ ...context, attemptNumber: event.attempt, startedAt: new Date(event.startedAtMs) })
    },
    async afterAttempt(outcome) {
      await finalizeUsageAttempt({ traceId: context.traceId, component: context.component, outcome })
    },
  }
}

export async function recordStandaloneUsage(params: UsageCorrelation & {
  operation: string
  component: string
  category: Exclude<UsageCostCategory, 'PROVIDER'>
  quantity: number | null
  unitType?: UsageUnitType
  measurementStatus: WorkloadMeasurementStatus
  rateVersion?: string
  currency?: string
}) {
  const trace = await createUsageTrace(params)
  const startedAt = new Date()
  await startUsageAttempt({
    traceId: trace.id, component: params.component, attemptNumber: 1, category: params.category,
    startedAt, rateVersion: params.rateVersion, currency: params.currency,
  })
  const outcome: ProviderAttemptOutcome = {
    attempt: 1, startedAtMs: startedAt.getTime(), endedAtMs: startedAt.getTime(), elapsedMs: 0,
    outcome: 'success', retryable: false, cancellation: 'wait_only',
  }
  await finalizeUsageAttempt({ traceId: trace.id, component: params.component, outcome })
  await recordUsageQuantities({
    traceId: trace.id, component: params.component, attemptNumber: 1,
    inputQuantity: params.quantity, outputQuantity: params.quantity === null ? null : 0,
    totalQuantity: params.quantity, unitType: params.unitType ?? 'ITEMS', measurementStatus: params.measurementStatus,
  })
  await finalizeUsageTrace({ traceId: trace.id, status: 'COMPLETED' })
  return trace.id
}

export async function withUsageTrace<T>(params: UsageCorrelation & {
  operation: string
  work: (control: { usageTraceId: string; markRefused: () => void }) => Promise<T>
}) {
  const trace = await createUsageTrace(params)
  let refused = false
  try {
    const result = await params.work({ usageTraceId: trace.id, markRefused: () => { refused = true } })
    await finalizeUsageTrace({ traceId: trace.id, status: refused ? 'REFUSED' : 'COMPLETED' })
    return result
  } catch (error) {
    await finalizeUsageTrace({
      traceId: trace.id,
      status: error instanceof Error && error.name === 'AbortError' ? 'CANCELLED' : 'FAILED',
      errorCategory: 'application',
    }).catch(() => undefined)
    throw error
  }
}

export async function withRecordedUsageAttempt<T>(params: UsageAttemptContext & {
  quantity: number
  unitType: UsageUnitType
  work: () => Promise<T>
}) {
  const startedAtMs = Date.now()
  await startUsageAttempt({ ...params, attemptNumber: 1, startedAt: new Date(startedAtMs) })
  try {
    const result = await params.work()
    const endedAtMs = Date.now()
    await finalizeUsageAttempt({ traceId: params.traceId, component: params.component, outcome: {
      attempt: 1, startedAtMs, endedAtMs, elapsedMs: Math.max(0, endedAtMs - startedAtMs),
      outcome: 'success', retryable: false, cancellation: 'wait_only',
    } })
    await recordUsageQuantities({
      traceId: params.traceId, component: params.component, attemptNumber: 1,
      inputQuantity: params.quantity, outputQuantity: 0, totalQuantity: params.quantity,
      unitType: params.unitType, measurementStatus: 'ESTIMATED',
    })
    return result
  } catch (error) {
    const endedAtMs = Date.now()
    await finalizeUsageAttempt({ traceId: params.traceId, component: params.component, outcome: {
      attempt: 1, startedAtMs, endedAtMs, elapsedMs: Math.max(0, endedAtMs - startedAtMs),
      outcome: 'failed', category: 'transport', retryable: false, cancellation: 'wait_only',
    } }).catch(() => undefined)
    throw error
  }
}
