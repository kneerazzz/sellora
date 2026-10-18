import { prisma } from '../../config/prisma'
import { env } from '../../config/env'

const workerRole = 'workflow'
const workerMaxAgeMs = 30_000
const alertWindowMs = 15 * 60_000

export async function recordWorkerHeartbeat(now = new Date()) {
  await prisma.workerHeartbeat.upsert({
    where: { role: workerRole },
    create: { role: workerRole, seenAt: now },
    update: { seenAt: now },
  })
}

export async function getWorkerHealth(now = new Date()) {
  const heartbeat = await prisma.workerHeartbeat.findUnique({ where: { role: workerRole } })
  return {
    status: heartbeat && heartbeat.seenAt.getTime() >= now.getTime() - workerMaxAgeMs ? 'ok' : 'stale',
    seenAt: heartbeat?.seenAt ?? null,
  }
}

export async function recordOperationalAlerts(now = new Date()) {
  const since = new Date(now.getTime() - alertWindowMs)
  const [failedProviderOrganizations, staleRunOrganizations] = await Promise.all([
    prisma.usageTrace.groupBy({
      by: ['organizationId'],
      where: { status: 'FAILED', completedAt: { gte: since }, attempts: { some: { category: 'PROVIDER' } } },
    }),
    prisma.workflowRun.groupBy({
      by: ['organizationId'],
      where: { status: 'RUNNING', leaseExpiresAt: { lt: now } },
    }),
  ])
  const period = Math.floor(now.getTime() / alertWindowMs)
  const alerts = [
    ...failedProviderOrganizations.map(({ organizationId }) => ({
      organizationId, kind: 'PROVIDER_FAILURE', dedupeKey: `provider-failure:${period}`,
    })),
    ...staleRunOrganizations.map(({ organizationId }) => ({
      organizationId, kind: 'WORKFLOW_STALE', dedupeKey: `workflow-stale:${period}`,
    })),
  ]
  if (alerts.length) await prisma.usageAlertEvent.createMany({ data: alerts, skipDuplicates: true })
}

export async function notifyOperationalAlerts(now = new Date(), webhookUrl = env.SLACK_ALERT_WEBHOOK_URL) {
  if (!webhookUrl) return
  // shortcut: a crash after Slack accepts a message can duplicate it; upgrade if delivery must be exactly once.
  const pending = await prisma.usageAlertEvent.findMany({
    where: { notifiedAt: null, OR: [{ notifyAfter: null }, { notifyAfter: { lte: now } }] },
    orderBy: { createdAt: 'asc' }, take: 10,
  })
  for (const alert of pending) {
    const claimed = await prisma.usageAlertEvent.updateMany({
      where: { id: alert.id, notifiedAt: null,
        OR: [{ notifyAfter: null }, { notifyAfter: { lte: now } }] },
      data: { notifyAfter: new Date(now.getTime() + 60_000) },
    })
    if (!claimed.count) continue
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `Sellora ${alert.kind} for organization ${alert.organizationId} at ${alert.createdAt.toISOString()}. Alert ${alert.id}.` }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) throw new Error('Slack webhook rejected alert')
      await prisma.usageAlertEvent.update({ where: { id: alert.id }, data: { notifiedAt: new Date(), notifyAfter: null } })
    } catch {
      console.error(JSON.stringify({ event: 'alert_delivery_failed', alertId: alert.id, organizationId: alert.organizationId }))
    }
  }
}

export async function getOperationalStatus(organizationId: string, now = new Date()) {
  const [worker, failedRuns, staleRuns, staleQuestionnaires, failedRows, alerts] = await Promise.all([
    getWorkerHealth(now),
    prisma.workflowRun.findMany({ where: { organizationId, status: 'FAILED' },
      select: { id: true, status: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    prisma.workflowRun.findMany({ where: { organizationId, status: 'RUNNING', leaseExpiresAt: { lt: now } },
      select: { id: true, status: true, leaseExpiresAt: true }, orderBy: { leaseExpiresAt: 'asc' }, take: 20 }),
    prisma.questionnaireJob.findMany({ where: { organizationId, status: 'RUNNING', leaseExpiresAt: { lt: now } },
      select: { id: true, status: true, leaseExpiresAt: true }, orderBy: { leaseExpiresAt: 'asc' }, take: 20 }),
    prisma.questionnaireRow.findMany({ where: { status: 'ERROR', job: { organizationId } },
      select: { jobId: true, rowIndex: true, errorCode: true }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    prisma.usageAlertEvent.findMany({ where: { organizationId },
      select: { id: true, kind: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ])
  return { worker, failedRuns, staleRuns, staleQuestionnaires, failedRows, alerts }
}
