import 'dotenv/config'
import { prisma } from '../config/prisma'
import { workflowRunsService } from '../modules/workflowRuns/workflowRuns.service'

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
  console.log(`Workflow worker started. Polling every ${pollMs}ms.`)
  try {
    while (!stop.signal.aborted) {
      try {
        const processed = await workflowRunsService.processQueuedWorkflowRuns({ limit: batchSize, signal: stop.signal })
        if (processed.length) console.log(`Processed ${processed.length} workflow run(s)`)
      } catch (error) {
        if (!stop.signal.aborted) console.error('Workflow worker poll failed:', error)
      }
      if (!stop.signal.aborted) await waitForPoll()
    }
  } finally {
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

startWorkflowWorker().catch(async (error) => {
  console.error('Workflow worker failed:', error)
  await prisma.$disconnect()
  process.exitCode = 1
})
