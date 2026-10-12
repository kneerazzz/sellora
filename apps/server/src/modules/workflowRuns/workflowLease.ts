import { randomUUID } from 'node:crypto'
import { Prisma, type WorkflowRun } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { assertWorkflowFinalization } from './workflowState'

function positiveInteger(name: string, fallback: number, maximum: number) {
  const raw = process.env[name]
  const value = raw === undefined ? fallback : Number(raw)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`)
  }
  return value
}

export const workflowLeasePolicy = {
  ttlMs: positiveInteger('WORKFLOW_LEASE_TTL_MS', 60_000, 600_000),
  maxAttempts: positiveInteger('WORKFLOW_MAX_ATTEMPTS', 3, 20),
  backoffMs: positiveInteger('WORKFLOW_RETRY_BASE_MS', 1_000, 60_000),
  maxBackoffMs: positiveInteger('WORKFLOW_RETRY_MAX_MS', 30_000, 600_000),
}

export type WorkflowClaim = Pick<WorkflowRun, 'id' | 'organizationId' | 'leaseOwner' | 'leaseVersion' | 'attemptCount' | 'maxAttempts'>

export function retryDelayMs(attempt: number) {
  return Math.min(workflowLeasePolicy.maxBackoffMs,
    workflowLeasePolicy.backoffMs * 2 ** Math.min(19, Math.max(0, attempt - 1)))
}

export async function claimWorkflow(params: { organizationId?: string; workflowRunId?: string } = {}): Promise<WorkflowClaim | null> {
  const owner = randomUUID()
  await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string; webhookEventId: string | null }>>`
      WITH expired AS (
        SELECT "id" FROM "workflow_runs"
        WHERE "status" = 'RUNNING' AND "leaseExpiresAt" <= NOW()
          AND "attemptCount" >= "maxAttempts"
          AND (${params.organizationId ?? null}::text IS NULL OR "organizationId" = ${params.organizationId ?? null})
          AND (${params.workflowRunId ?? null}::text IS NULL OR "id" = ${params.workflowRunId ?? null})
        ORDER BY "leaseExpiresAt" ASC FOR UPDATE SKIP LOCKED LIMIT 100
      )
      UPDATE "workflow_runs" AS run SET "status" = 'FAILED', "completedAt" = NOW(),
        "errorMessage" = 'Worker lease expired after maximum attempts',
        "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "heartbeatAt" = NULL,
        "nextAttemptAt" = NULL, "updatedAt" = NOW()
      FROM expired WHERE run."id" = expired."id"
      RETURNING run."id", run."webhookEventId"`
    for (const row of rows) {
      if (row.webhookEventId) await tx.webhookEvent.update({
        where: { id: row.webhookEventId },
        data: { status: 'FAILED', processedAt: new Date(), errorMessage: 'Worker lease expired after maximum attempts' },
      })
    }
  })

  const rows = await prisma.$queryRaw<WorkflowClaim[]>`
    WITH candidate AS (
      SELECT "id" FROM "workflow_runs"
      WHERE "type" IN ('SALES_EVENT_EXTRACTION'::"WorkflowRunType", 'GROUNDED_TECHNICAL_ANSWER'::"WorkflowRunType")
        AND (${params.organizationId ?? null}::text IS NULL OR "organizationId" = ${params.organizationId ?? null})
        AND (${params.workflowRunId ?? null}::text IS NULL OR "id" = ${params.workflowRunId ?? null})
        AND "attemptCount" < "maxAttempts"
        AND ("status" = 'QUEUED' OR ("status" = 'RETRY_WAIT' AND "nextAttemptAt" <= NOW())
          OR ("status" = 'RUNNING' AND "leaseExpiresAt" <= NOW()))
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "workflow_runs" AS run SET "status" = 'RUNNING', "startedAt" = COALESCE(run."startedAt", NOW()),
      "completedAt" = NULL, "nextAttemptAt" = NULL, "errorMessage" = NULL,
      "attemptCount" = run."attemptCount" + 1, "leaseVersion" = run."leaseVersion" + 1,
      "leaseOwner" = ${owner}, "leaseExpiresAt" = NOW() + (${workflowLeasePolicy.ttlMs}::int * INTERVAL '1 millisecond'),
      "heartbeatAt" = NOW(), "updatedAt" = NOW()
    FROM candidate WHERE run."id" = candidate."id"
    RETURNING run."id", run."organizationId", run."leaseOwner", run."leaseVersion", run."attemptCount", run."maxAttempts"`
  return rows[0] ?? null
}

export async function heartbeatWorkflow(claim: WorkflowClaim): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE "workflow_runs" SET "heartbeatAt" = NOW(),
      "leaseExpiresAt" = NOW() + (${workflowLeasePolicy.ttlMs}::int * INTERVAL '1 millisecond'),
      "updatedAt" = NOW()
    WHERE "id" = ${claim.id} AND "organizationId" = ${claim.organizationId}
      AND "status" = 'RUNNING' AND "leaseOwner" = ${claim.leaseOwner}
      AND "leaseVersion" = ${claim.leaseVersion} AND "leaseExpiresAt" > NOW()`
  return count === 1
}

export async function finalizeWorkflow(claim: WorkflowClaim, data: {
  status: 'COMPLETED' | 'RETRY_WAIT' | 'FAILED'
  output?: Prisma.InputJsonValue
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW'
  reviewStatus?: 'NOT_REQUESTED' | 'REQUIRED'
  errorMessage?: string | null
  nextAttemptAt?: Date
}): Promise<boolean> {
  assertWorkflowFinalization(data)
  return prisma.$transaction(async tx => {
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`
    const updated = await tx.workflowRun.updateMany({
      where: { id: claim.id, organizationId: claim.organizationId, status: 'RUNNING',
        leaseOwner: claim.leaseOwner, leaseVersion: claim.leaseVersion, leaseExpiresAt: { gt: now } },
      data: { ...data, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null,
        completedAt: data.status === 'RETRY_WAIT' ? null : now,
        nextAttemptAt: data.status === 'RETRY_WAIT' ? data.nextAttemptAt : null },
    })
    if (updated.count !== 1) return false
    const run = await tx.workflowRun.findUniqueOrThrow({ where: { id: claim.id }, select: { webhookEventId: true } })
    if (run.webhookEventId && data.status !== 'RETRY_WAIT') await tx.webhookEvent.update({
      where: { id: run.webhookEventId },
      data: { status: data.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED', processedAt: now,
        errorMessage: data.status === 'FAILED' ? data.errorMessage : null },
    })
    return true
  })
}
