/** Built Knowledge UI journey against a synthetic loopback API; no client/provider data. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const profile = await mkdtemp(path.join(tmpdir(), 'sellora-knowledge-browser-'))
const now = new Date().toISOString()
const user = { id: 'admin', organizationId: 'org', email: 'fixture@test.invalid',
  firstName: 'Browser', lastName: 'Fixture', role: 'ADMIN' }
const makeDoc = id => ({ id, createdAt: now, updatedAt: now, filename: 'policy.pdf',
  displayName: 'Policy', description: null, mimeType: 'application/pdf', sizeBytes: 200,
  fileType: 'PDF', status: 'COMPLETED', errorMessage: null, pageCount: 2, totalChunks: 1,
  embeddingModel: 'nomic-embed-text', ingestedAt: now, activeVersionId: 'v1', deletedAt: null,
  tags: [], organizationId: 'org', uploadedById: 'admin' })
const docs = [makeDoc('doc-a'), makeDoc('doc-b')]
const version = (id, number, status, errorMessage = null) => ({ id, versionNumber: number,
  basedOnVersionId: number > 1 ? `v${number - 1}` : null, contentHash: 'a'.repeat(64),
  status, errorMessage, createdAt: now, publishedAt: status === 'ACTIVE' ? now : null,
  filename: 'policy.pdf', mimeType: 'application/pdf', sizeBytes: 200, pageCount: 2,
  totalChunks: status === 'FAILED' ? null : 1 })
const versions = [version('v1', 1, 'ACTIVE')]
const actions = []
let replaceCount = 0
let uploadCount = 0
let result
let finish
let timeout
const completed = new Promise(resolve => { finish = resolve })
const response = data => JSON.stringify({ success: true, statusCode: 200, message: 'Fixture', data })
const error = message => JSON.stringify({ success: false, statusCode: 500, message, errors: [] })
const testScript = `<script>
  (async () => {
    const waitFor = async predicate => {
      for (let i = 0; i < 120; i++) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Timed out: ' + document.querySelector('#root')?.textContent?.slice(-400));
    };
    const putFile = input => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(['fixture'], 'replacement.txt', { type: 'text/plain' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const clickText = (root, label) => {
      const button = [...root.querySelectorAll('button')].find(node => node.textContent.trim() === label);
      if (!button) throw new Error('Missing button ' + label);
      button.click();
    };
    try {
      await waitFor(() => document.querySelectorAll('tbody tr').length === 2);
      if (document.querySelectorAll('tbody tr')[0].textContent === document.querySelectorAll('tbody tr')[1].textContent)
        throw new Error('Duplicate filenames not distinguishable');
      document.querySelector('button[aria-label="Inspect Policy doc-a"]').click();
      await waitFor(() => document.querySelector('[role="dialog"]')?.textContent.includes('Version 1'));
      let dialog = document.querySelector('[role="dialog"]');
      clickText(dialog, 'Inspect');
      await waitFor(() => dialog.textContent.includes('Page 2'));
      clickText(dialog, 'Replace file');
      putFile(dialog.querySelector('input[type=file]'));
      await waitFor(() => dialog.textContent.includes('Version 2'));
      clickText(dialog, 'Replace file');
      putFile(dialog.querySelector('input[type=file]'));
      await waitFor(() => dialog.textContent.includes('Fixture parser failure') && dialog.textContent.includes('Version 3'));
      clickText(dialog, 'Retry');
      await waitFor(() => dialog.textContent.includes('Version 3 · ACTIVE'));
      clickText(dialog, 'Delete source');
      await waitFor(() => dialog.textContent.includes('Confirm delete'));
      clickText(dialog, 'Confirm delete');
      await waitFor(() => dialog.textContent.includes('Deleted source'));
      if (!dialog.textContent.includes('Passage unavailable')) clickText(dialog, 'Inspect');
      await waitFor(() => dialog.textContent.includes('Passage unavailable'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await waitFor(() => !document.querySelector('[role="dialog"]'));
      clickText(document, 'Upload document');
      putFile(document.querySelector('input[type=file]'));
      await waitFor(() => document.querySelectorAll('tbody tr').length === 3);
      clickText(document, 'Upload document');
      putFile(document.querySelector('input[type=file]'));
      await waitFor(() => [...document.querySelectorAll('button')].some(node => node.textContent === 'Cancel request'));
      clickText(document, 'Cancel request');
      await waitFor(() => document.querySelector('[role=alert]')?.textContent.includes('Request cancelled'));
      await fetch('/__result', { method: 'POST', body: JSON.stringify({ ok: true }) });
    } catch (cause) {
      await fetch('/__result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(cause) }) });
    }
  })();
</script>`
const server = createServer(async (req, res) => {
  const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(body) }
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  if (pathname === '/__result' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk
    result = JSON.parse(body); send(200, '{}'); finish(); return
  }
  if (pathname === '/api/v1/auth/refresh') return send(200, response({ user, accessToken: 'synthetic-token' }))
  if (pathname === '/api/v1/users/me') return send(200, response(user))
  if (pathname === '/api/v1/documents' && req.method === 'GET') return send(200, response(docs))
  if (pathname === '/api/v1/documents/doc-a/versions' && req.method === 'GET') return send(200, response([...versions].reverse()))
  const source = pathname.match(/^\/api\/v1\/documents\/doc-a\/versions\/(v[123])\/source$/)
  if (source && req.method === 'GET') {
    const current = docs[0].activeVersionId === source[1] && !docs[0].deletedAt
    return send(200, response({ versionId: source[1], versionNumber: Number(source[1].slice(1)),
      availability: current ? 'CURRENT' : 'UNAVAILABLE', truncated: false,
      chunks: current ? [{ id: 'chunk', chunkIndex: 0, text: 'Refund passage', pageNumber: 2,
        headingPath: [], sectionTitle: null }] : [] }))
  }
  if (pathname === '/api/v1/documents/doc-a/replace-file' && req.method === 'POST') {
    for await (const _chunk of req) { /* consume multipart fixture */ }
    replaceCount++
    actions.push('replace')
    if (replaceCount === 1) {
      versions[0].status = 'RETIRED'
      versions.push(version('v2', 2, 'ACTIVE'))
      docs[0].activeVersionId = 'v2'
      return send(200, response(docs[0]))
    }
    versions.push(version('v3', 3, 'FAILED', 'Fixture parser failure'))
    return send(500, error('Fixture parser failure'))
  }
  if (pathname === '/api/v1/documents/doc-a/versions/v3/retry' && req.method === 'POST') {
    actions.push('retry')
    versions[1].status = 'RETIRED'; versions[2].status = 'ACTIVE'
    docs[0].activeVersionId = 'v3'
    return send(200, response(docs[0]))
  }
  if (pathname === '/api/v1/documents/doc-a' && req.method === 'DELETE') {
    actions.push('delete')
    docs[0].activeVersionId = null; docs[0].deletedAt = now; docs[0].status = 'DELETED'
    return send(200, response(docs[0]))
  }
  if (pathname === '/api/v1/documents/upload-file' && req.method === 'POST') {
    for await (const _chunk of req) { /* consume multipart fixture */ }
    uploadCount++
    if (uploadCount === 1) {
      actions.push('upload')
      const added = makeDoc('doc-c')
      docs.push(added)
      return send(201, response(added))
    }
    actions.push('upload-cancel')
    await new Promise(resolve => setTimeout(resolve, 3000))
    return send(201, response(makeDoc('doc-d')))
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
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  browser = spawn('firefox', ['--headless', '--no-remote', '--profile', profile,
    `http://127.0.0.1:${address.port}/documents`], { stdio: 'ignore' })
  await Promise.race([completed, new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Firefox Knowledge check timed out')), 35_000)
  })])
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(actions.slice(0, 5), ['replace', 'replace', 'retry', 'delete', 'upload'])
  assert.ok(actions.length === 5 || (actions.length === 6 && actions[5] === 'upload-cancel'))
  console.log('PASS Firefox Knowledge duplicate names, page source, replace/failure/retry/delete, upload and cancel')
} finally {
  clearTimeout(timeout); browser?.kill()
  if (server.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await rm(profile, { recursive: true, force: true })
}
