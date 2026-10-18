import 'dotenv/config'
import { prisma } from '../config/prisma'
import { workflowRunsService } from '../modules/workflowRuns/workflowRuns.service'
import { questionnairesService } from '../modules/questionnaires/questionnaires.service'
import { notifyOperationalAlerts, recordOperationalAlerts, recordWorkerHeartbeat } from '../modules/usage/operationalHealth.service'

function bounded(name: string, fallback: number, maximum: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`)
  }
  return value
}

const pollMs = bounded('WORKFLOW_WORKER_POLL_INTERVAL_MS', 10_000, 60_000)
const batchSize = bounded('WORKFLOW_WORKER_BATCH_SIZE', 5, 50)
const shutdownMs = bounded('WORKFLOW_WORKER_SHUTDOWN_MS', 15_000, 60_000)
const stop = new AbortController()
let wake: (() => void) | undefined

async function waitForPoll() {
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { wake = undefined; resolve() }, pollMs)
    wake = () => { clearTimeout(timer); wake = undefined; resolve() }
    if (stop.signal.aborted) wake()
  })
}

async function startWorkflowWorker() {
  process.once('SIGTERM', () => { stop.abort(new Error('Worker stopping')); wake?.() })
  process.once('SIGINT', () => { stop.abort(new Error('Worker stopping')); wake?.() })
  await prisma.$connect()
  await recordWorkerHeartbeat()
  const heartbeat = setInterval(() => {
    void recordWorkerHeartbeat().catch(() => console.error('Workflow worker heartbeat failed'))
  }, 10_000)
  console.log(`Workflow worker started. Polling every ${pollMs}ms.`)
  try {
    while (!stop.signal.aborted) {
      try {
        await recordOperationalAlerts()
        await notifyOperationalAlerts()
        const processed = await workflowRunsService.processQueuedWorkflowRuns({ limit: batchSize, signal: stop.signal })
        for (const run of processed) console.log(JSON.stringify({ event: 'workflow_processed',
          runId: run.id, organizationId: run.organizationId, status: run.status }))
        const questionnaire = await questionnairesService.processNext({ signal: stop.signal })
        if (questionnaire) console.log(JSON.stringify({ event: 'questionnaire_processed',
          jobId: questionnaire.id, organizationId: questionnaire.organizationId, status: questionnaire.status }))
      } catch {
        if (!stop.signal.aborted) console.error('Workflow worker poll failed')
      }
      if (!stop.signal.aborted) await waitForPoll()
    }
  } finally {
    clearInterval(heartbeat)
    await prisma.$disconnect()
  }
}

const shutdownTimer = setInterval(() => {
  if (stop.signal.aborted) {
    setTimeout(() => process.exit(1), shutdownMs).unref()
    clearInterval(shutdownTimer)
  }
}, 100)
shutdownTimer.unref()

startWorkflowWorker().catch(async () => {
  console.error('Workflow worker failed')
  await prisma.$disconnect()
  process.exitCode = 1
})
