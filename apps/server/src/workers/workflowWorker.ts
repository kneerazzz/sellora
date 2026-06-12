import 'dotenv/config'
import { prisma } from '../config/prisma'
import { workflowRunsService } from '../modules/workflowRuns/workflowRuns.service'

const POLL_INTERVAL_MS = Number(process.env.WORKFLOW_WORKER_POLL_INTERVAL_MS ?? 10_000)
const BATCH_SIZE = Number(process.env.WORKFLOW_WORKER_BATCH_SIZE ?? 5)

async function tick() {
  const processed = await workflowRunsService.processQueuedWorkflowRuns({
    limit: BATCH_SIZE,
  })

  if (processed.length > 0) {
    console.log(`Processed ${processed.length} queued workflow run(s)`)
  }
}

async function startWorkflowWorker() {
  await prisma.$connect()
  console.log(`Workflow worker started. Polling every ${POLL_INTERVAL_MS}ms.`)

  const interval = setInterval(() => {
    tick().catch((error) => {
      console.error('Workflow worker tick failed:', error)
    })
  }, POLL_INTERVAL_MS)

  await tick()

  const shutdown = async (signal: string) => {
    console.log(`${signal} received. Stopping workflow worker.`)
    clearInterval(interval)
    await prisma.$disconnect()
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

startWorkflowWorker().catch(async (error) => {
  console.error('Workflow worker failed to start:', error)
  await prisma.$disconnect()
  process.exit(1)
})
