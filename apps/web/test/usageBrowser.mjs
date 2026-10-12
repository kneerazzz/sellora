/** Browser smoke for the built usage screen with a local, synthetic API. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const profile = await mkdtemp(path.join(tmpdir(), 'sellora-usage-browser-'))
const user = { id: 'browser-admin', organizationId: 'browser-org', email: 'fixture@test.invalid',
  firstName: 'Browser', lastName: 'Fixture', role: 'ADMIN' }
let paused = false
let pauseCalls = 0
const requests = []
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
      throw new Error('Timed out waiting for usage screen: ' + document.querySelector('#root')?.textContent?.slice(0, 300));
    };
    try {
      await waitFor(() => document.querySelector('#root')?.textContent.includes('1,000 remaining of 2,000 units'));
      if (!document.querySelector('#root')?.textContent.includes('1 unknown attempt measurements')) throw new Error('Unknown count missing');
      if (!document.querySelector('#root')?.textContent.includes('not a customer invoice')) throw new Error('Invoice caveat missing');
      const button = [...document.querySelectorAll('button')].find(node => node.textContent.includes('Pause new work'));
      if (!button) throw new Error('Pause button missing: ' + [...document.querySelectorAll('button')].map(node => node.textContent).join('|'));
      button.click();
      await waitFor(() => document.querySelector('#root')?.textContent.includes('New expensive work is paused.'));
      const resume = [...document.querySelectorAll('button')].find(node => node.textContent.includes('Resume new work'));
      if (!resume) throw new Error('Resume button missing');
      resume.click();
      await waitFor(() => document.querySelector('#root')?.textContent.includes('New expensive work is enabled.'));
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
  requests.push(`${req.method} ${pathname}`)
  if (pathname === '/__result' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk
    result = JSON.parse(body); send(200, '{}'); finish(); return
  }
  if (pathname === '/api/v1/auth/refresh') return send(200, response({ user, accessToken: 'synthetic-browser-token' }))
  if (pathname === '/api/v1/users/me') return send(200, response(user))
  if (pathname === '/api/v1/usage/pause' && req.method === 'PUT') {
    let body = ''; for await (const chunk of req) body += chunk
    paused = JSON.parse(body).paused; pauseCalls += 1
    return send(200, response({ paused }))
  }
  if (pathname === '/api/v1/usage/summary') return send(200, response({
    paused, periodStart: new Date().toISOString(), asOf: new Date().toISOString(),
    maxUnits: 2000, usedUnits: 1000, remainingUnits: 1000, maxConcurrent: 4,
    activeReservations: 1, unknownReservations: 1, unknownAttempts: 1,
    failedTraces: [], costlyTraces: [], alerts: [],
    measurementNotice: 'Engineering units and unpriced estimates only; this is not a customer invoice.',
  }))
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
    `http://127.0.0.1:${address.port}/usage`], { stdio: 'ignore' })
  await Promise.race([completed, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Firefox browser check timed out')), 30_000)
  })])
  assert.deepEqual(result, { ok: true }, requests.join(', '))
  assert.equal(pauseCalls, 2)
  assert.equal(paused, false)
  console.log('PASS Firefox production-build usage summary, pause and resume browser journey')
} finally {
  clearTimeout(timeout)
  browser?.kill()
  if (server.listening) {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
  await rm(profile, { recursive: true, force: true })
}
