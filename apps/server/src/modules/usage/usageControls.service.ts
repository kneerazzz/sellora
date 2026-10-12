import { prisma } from '../../config/prisma'
import { defaultWorkloadLimits } from './workloadReservations.service'
import { randomUUID } from 'node:crypto'

export async function setUsagePause(organizationId: string, actorId: string, paused: boolean) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0)) IS NULL AS locked`
    const existing = await tx.organizationUsageControl.findUnique({ where: { organizationId } })
    if (!existing && !paused) return { paused: false }
    if (existing?.paused === paused) return existing
    const control = await tx.organizationUsageControl.upsert({
      where: { organizationId },
      create: { organizationId, paused, updatedById: actorId },
      update: { paused, updatedById: actorId },
    })
    await tx.usageAlertEvent.create({ data: {
      organizationId, kind: paused ? 'WORK_PAUSED' : 'WORK_RESUMED',
      dedupeKey: `control:${randomUUID()}`,
    } })
    return control
  })
}

export async function getUsageSummary(organizationId: string, now = new Date()) {
  const periodStart = new Date(now.getTime() - defaultWorkloadLimits.periodMs)
  const [control, rows, unknownAttempts, failedTraces, costlyTraces, alerts] = await Promise.all([
    prisma.organizationUsageControl.findUnique({ where: { organizationId } }),
    prisma.$queryRaw<Array<{ active: bigint; used: bigint; unknownReservations: bigint }>>`
      SELECT count(*) FILTER (WHERE "status" = 'RESERVED' AND "expiresAt" > ${now})::bigint AS active,
        COALESCE(sum(CASE
          WHEN "createdAt" < ${periodStart} OR "status" = 'RELEASED' THEN 0
          WHEN "status" = 'RECONCILED' AND "actualUnits" IS NOT NULL THEN "actualUnits"
          ELSE "reservedUnits" END), 0)::bigint AS used,
        count(*) FILTER (WHERE "createdAt" >= ${periodStart} AND "measurementStatus" = 'UNKNOWN')::bigint AS "unknownReservations"
      FROM "workload_reservations" WHERE "organizationId" = ${organizationId}`,
    prisma.usageAttempt.count({ where: { trace: { organizationId }, measurementStatus: 'UNKNOWN', createdAt: { gte: periodStart } } }),
    prisma.usageTrace.findMany({ where: { organizationId, status: { in: ['FAILED', 'CANCELLED'] }, createdAt: { gte: periodStart } },
      select: { id: true, operation: true, status: true, requestId: true, workflowRunId: true, createdAt: true, errorCategory: true },
      orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.usageTrace.findMany({ where: { organizationId, reservation: { is: { createdAt: { gte: periodStart } } } },
      select: { id: true, operation: true, status: true, createdAt: true, reservation: { select: { reservedUnits: true } } },
      orderBy: { reservation: { reservedUnits: 'desc' } }, take: 10 }),
    prisma.usageAlertEvent.findMany({ where: { organizationId }, select: { id: true, kind: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 10 }),
  ])
  const usedUnits = Number(rows[0]?.used ?? 0)
  const maxUnits = defaultWorkloadLimits.maxPeriodUnits
  return {
    paused: control?.paused ?? false,
    periodStart, asOf: now, periodWindowSeconds: defaultWorkloadLimits.periodMs / 1000,
    maxUnits, usedUnits, remainingUnits: Math.max(0, maxUnits - usedUnits),
    maxConcurrent: defaultWorkloadLimits.maxConcurrent,
    activeReservations: Number(rows[0]?.active ?? 0),
    unknownReservations: Number(rows[0]?.unknownReservations ?? 0), unknownAttempts,
    failedTraces, costlyTraces: costlyTraces.map(trace => ({
      id: trace.id, operation: trace.operation, status: trace.status, createdAt: trace.createdAt,
      reservedUnits: trace.reservation?.reservedUnits ?? null,
    })), alerts,
    measurementNotice: 'Engineering units and unpriced estimates only; this is not a customer invoice.',
  }
}
