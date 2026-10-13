/** Browser check for the built workflow activity/retry/cancel UI with a synthetic API. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const profile = await mkdtemp(path.join(tmpdir(), 'sellora-workflow-browser-'))
const user = { id: 'browser-admin', organizationId: 'browser-org', email: 'fixture@test.invalid',
  firstName: 'Browser', lastName: 'Fixture', role: 'ADMIN' }
const now = new Date().toISOString()
const runs = [
  { id: 'failed-run', createdAt: now, updatedAt: now, type: 'GROUNDED_TECHNICAL_ANSWER', status: 'FAILED',
    reviewStatus: 'NOT_REQUESTED', deliveryStatus: 'NOT_REQUESTED', confidence: null,
    startedAt: now, completedAt: now, errorMessage: 'Original failure', attemptCount: 3, maxAttempts: 3,
    nextAttemptAt: null, leaseExpiresAt: null, organizationId: 'browser-org', webhookEventId: null,
    input: { question: 'fixture' }, output: { kind: 'GROUNDED_ANSWER_PARTIAL', result: { answer: 'Saved partial' } },
    activities: [{ id: 'event-fail', createdAt: now, kind: 'FAILED', attemptCount: 3,
      message: 'Original failure', actorUserId: null }] },
  { id: 'queued-run', createdAt: now, updatedAt: now, type: 'GROUNDED_TECHNICAL_ANSWER', status: 'QUEUED',
    reviewStatus: 'NOT_REQUESTED', deliveryStatus: 'NOT_REQUESTED', confidence: null,
    startedAt: null, completedAt: null, errorMessage: null, attemptCount: 0, maxAttempts: 3,
    nextAttemptAt: null, leaseExpiresAt: null, organizationId: 'browser-org', webhookEventId: null,
    input: { question: 'queued' }, output: null, activities: [] },
]
const actions = []
let result
let finish
let timeout
const completed = new Promise(resolve => { finish = resolve })
const response = data => JSON.stringify({ success: true, statusCode: 200, message: 'Fixture', data })
const testScript = `<script>
  (async () => {
    const waitFor = async (predicate) => {
      for (let i = 0; i < 100; i++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Timed out waiting for workflow screen: ' + document.querySelector('#root')?.textContent?.slice(0, 300));
    };
    try {
      await waitFor(() => document.querySelectorAll('tbody tr').length === 2);
      document.querySelector('tbody tr button').click();
      await waitFor(() => document.querySelector('[role="dialog"]')?.textContent.includes('Original failure'));
      if (!document.querySelector('[role="dialog"]')?.textContent.includes('Saved partial')) throw new Error('Partial result missing');
      [...document.querySelectorAll('[role="dialog"] button')].find(node => node.textContent === 'Retry').click();
      await waitFor(() => document.querySelector('[role="dialog"]')?.textContent.includes('RETRIED'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await waitFor(() => !document.querySelector('[role="dialog"]'));
      document.querySelectorAll('tbody tr')[1].querySelector('button').click();
      await waitFor(() => document.querySelector('[role="dialog"]')?.textContent.includes('QUEUED'));
      [...document.querySelectorAll('[role="dialog"] button')].find(node => node.textContent === 'Cancel').click();
      await waitFor(() => document.querySelector('[role="dialog"]')?.textContent.includes('CANCELLED'));
      await fetch('/__result', { method: 'POST', body: JSON.stringify({ ok: true }) });
    } catch (error) {
      await fetch('/__result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error) }) });
    }
  })();
</script>`
const server = createServer(async (req, res) => {
  const send = (status, body, type = 'application/json') => {
    res.writeHead(status, { 'content-type': type }); res.end(body)
  }
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  if (pathname === '/__result' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk
    result = JSON.parse(body); send(200, '{}'); finish(); return
  }
  if (pathname === '/api/v1/auth/refresh') return send(200, response({ user, accessToken: 'synthetic-browser-token' }))
  if (pathname === '/api/v1/users/me') return send(200, response(user))
  if (pathname === '/api/v1/workflow-runs' && req.method === 'GET') return send(200, response(runs))
  const match = pathname.match(/^\/api\/v1\/workflow-runs\/(failed-run|queued-run)(?:\/(retry|cancel))?$/)
  if (match) {
    const run = runs.find(item => item.id === match[1])
    if (req.method === 'GET') return send(200, response(run))
    if (req.method === 'POST' && match[2]) {
      actions.push(match[2])
      run.status = match[2] === 'retry' ? 'QUEUED' : 'CANCELLED'
      run.errorMessage = match[2] === 'retry' ? 'Original failure' : 'Cancelled by operator'
      run.activities.unshift({ id: `event-${match[2]}`, createdAt: now, kind: match[2] === 'retry' ? 'RETRIED' : 'CANCELLED',
        attemptCount: run.attemptCount, message: 'Operator action', actorUserId: user.id })
      return send(200, response(run))
    }
  }
  if (pathname.startsWith('/assets/')) {
    const file = path.join(appDir, 'dist', pathname)
    if (!file.startsWith(path.join(appDir, 'dist', 'assets') + path.sep)) return send(404, '')
    try { return send(200, await readFile(file), pathname.endsWith('.js') ? 'text/javascript' : 'text/css') }
    catch { return send(404, '') }
  }
  const html = await readFile(path.join(appDir, 'dist/index.html'), 'utf8')
  send(200, html.replace('</body>', `${testScript}</body>`), 'text/html')
})

let browser
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  browser = spawn('firefox', ['--headless', '--no-remote', '--profile', profile,
    `http://127.0.0.1:${address.port}/workflow-runs`], { stdio: 'ignore' })
  await Promise.race([completed, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Firefox workflow browser check timed out')), 30_000)
  })])
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(actions, ['retry', 'cancel'])
  console.log('PASS Firefox workflow activity, preserved partial result, retry and cancel controls')
} finally {
  clearTimeout(timeout)
  browser?.kill()
  if (server.listening) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  await rm(profile, { recursive: true, force: true })
}
