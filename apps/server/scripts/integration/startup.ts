import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Startup smoke requires a localhost sellora_test_* database')
}
const db = new pg.Client({ connectionString: target })
await db.connect()
const children: ChildProcess[] = []

async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exit = once(child, 'exit')
  child.kill('SIGTERM')
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000)
  try { await exit } finally { clearTimeout(deadline) }
  assert.equal(child.exitCode, 0, 'Process must shut down cleanly')
}

async function start(script: string, marker: string, extra: Record<string, string> = {}) {
  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', DATABASE_URL: target!, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  let output = ''
  let failed = false
  child.on('error', () => { failed = true })
  child.stdout!.on('data', data => { output = (output + String(data)).slice(-8000) })
  child.stderr!.resume() // No environment/provider details in test output.
  for (let attempt = 0; attempt < 200; attempt++) {
    if (output.includes(marker)) return child
    if (failed || child.exitCode !== null || child.signalCode !== null) break
    await delay(100)
  }
  throw new Error(`Startup failed or timed out: ${script}`)
}

try {
  const rows = await db.query('SELECT count(*)::int AS count FROM workflow_runs')
  assert.equal(rows.rows[0].count, 0, 'Worker smoke refuses a nonempty queue')
  const migrations = await db.query('SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
  assert.ok(migrations.rows[0].count > 0)

  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))

  await start('src/index.ts', 'Sellora API running', { PORT: String(port) })
  const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(5000) })
  assert.equal(health.status, 200)
  assert.equal((await health.json() as { data: { status: string } }).data.status, 'ok')
  const denied = await fetch(`http://127.0.0.1:${port}/api/v1/documents`, { signal: AbortSignal.timeout(5000) })
  assert.equal(denied.status, 401)
  await start('src/workers/workflowWorker.ts', 'Workflow worker started', {
    WORKFLOW_WORKER_POLL_INTERVAL_MS: '100', WORKFLOW_WORKER_BATCH_SIZE: '1',
  })
  await delay(500)
  for (const child of children) assert.equal(child.exitCode, null)
  console.log('PASS migrated API health, unauthenticated document rejection and empty-queue worker startup')
} finally {
  const outcomes = await Promise.allSettled(children.map(stop))
  await db.end()
  const failure = outcomes.find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}
