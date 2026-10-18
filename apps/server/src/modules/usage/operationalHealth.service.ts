import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { z } from 'zod'

const workerRole = 'workflow'
const workerMaxAgeMs = 30_000
const alertWindowMs = 15 * 60_000

const clientWebhooks = (() => {
  try {
    return z.record(z.string(), z.url().refine(value => new URL(value).origin === 'https://hooks.slack.com'))
      .parse(JSON.parse(env.SLACK_CLIENT_WEBHOOK_URLS))
  } catch {
    throw new Error('Invalid client Slack webhook configuration')
  }
})()

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

export async function notifyOperationalAlerts(
  now = new Date(), operatorWebhookUrl = env.SLACK_ALERT_WEBHOOK_URL,
  clientWebhookUrls: Record<string, string> = clientWebhooks
) {
  // shortcut: a crash after Slack accepts a message can duplicate it; upgrade if delivery must be exactly once.
  // shortcut: client webhook mapping is worker configuration, move to a secret store when client onboarding is automated.
  const clientOrganizationIds = Object.keys(clientWebhookUrls)
  const [operatorPending, clientPending] = await Promise.all([
    operatorWebhookUrl ? prisma.usageAlertEvent.findMany({
      where: { notifiedAt: null, OR: [{ notifyAfter: null }, { notifyAfter: { lte: now } }] },
      orderBy: { createdAt: 'asc' }, take: 10,
    }) : [],
    clientOrganizationIds.length ? prisma.usageAlertEvent.findMany({
      where: { organizationId: { in: clientOrganizationIds }, clientNotifiedAt: null,
        OR: [{ clientNotifyAfter: null }, { clientNotifyAfter: { lte: now } }] },
      orderBy: { createdAt: 'asc' }, take: 10,
    }) : [],
  ])
  for (const [alert, destination, webhookUrl] of [
    ...operatorPending.map(alert => [alert, 'operator', operatorWebhookUrl] as const),
    ...clientPending.map(alert => [alert, 'client', clientWebhookUrls[alert.organizationId]] as const),
  ]) {
    if (!webhookUrl) continue
    const operator = destination === 'operator'
    const claimed = await prisma.usageAlertEvent.updateMany({
      where: operator ? { id: alert.id, notifiedAt: null,
        OR: [{ notifyAfter: null }, { notifyAfter: { lte: now } }] } :
        { id: alert.id, clientNotifiedAt: null,
          OR: [{ clientNotifyAfter: null }, { clientNotifyAfter: { lte: now } }] },
      data: operator ? { notifyAfter: new Date(now.getTime() + 60_000) } :
        { clientNotifyAfter: new Date(now.getTime() + 60_000) },
    })
    if (!claimed.count) continue
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: operator
          ? `Sellora ${alert.kind} for organization ${alert.organizationId} at ${alert.createdAt.toISOString()}. Alert ${alert.id}.`
          : `Sellora ${alert.kind} at ${alert.createdAt.toISOString()}. Alert ${alert.id}.` }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) throw new Error('Slack webhook rejected alert')
      await prisma.usageAlertEvent.update({ where: { id: alert.id }, data: operator
        ? { notifiedAt: new Date(), notifyAfter: null }
        : { clientNotifiedAt: new Date(), clientNotifyAfter: null } })
    } catch {
      console.error(JSON.stringify({ event: 'alert_delivery_failed', alertId: alert.id,
        organizationId: alert.organizationId, destination }))
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
