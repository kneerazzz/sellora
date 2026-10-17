/** Browser acceptance against this runner's migrated disposable database and real API. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const targetUrl = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(targetUrl.hostname) || !targetUrl.pathname.startsWith('/sellora_test_')) {
  throw new Error('Draft browser fixture requires a localhost sellora_test_* target')
}
process.env.DATABASE_URL = target
process.env.NODE_ENV = 'test'

const webDist = fileURLToPath(new URL('../../../web/dist/', import.meta.url))
const profile = await mkdtemp(path.join(tmpdir(), 'sellora-drafts-real-browser-'))
let app: ReturnType<typeof import('../../src/app').createApp> | undefined
let browser: ReturnType<typeof spawn> | undefined
let timeout: ReturnType<typeof setTimeout> | undefined
let result: { ok: boolean; error?: string } | undefined
let finish!: () => void
const completed = new Promise<void>(resolve => { finish = resolve })
let concurrentEdit: (() => Promise<void>) | undefined
let reviewEdit: (() => Promise<void>) | undefined
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  if (pathname.startsWith('/api/')) return app!(req, res)
  if (pathname === '/__concurrent' && req.method === 'POST') {
    try { await concurrentEdit!(); res.writeHead(204); res.end() }
    catch { res.writeHead(500); res.end() }
    return
  }
  if (pathname === '/__queue' && req.method === 'POST') {
    try { await reviewEdit!(); res.writeHead(204); res.end() }
    catch { res.writeHead(500); res.end() }
    return
  }
  if (pathname === '/__result' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    result = JSON.parse(body)
    res.writeHead(204); res.end(); finish(); return
  }
  if (pathname.startsWith('/assets/')) {
    const asset = path.resolve(webDist, `.${pathname}`)
    if (!asset.startsWith(path.join(webDist, 'assets') + path.sep)) { res.writeHead(404); res.end(); return }
    try { const data = await readFile(asset); res.writeHead(200, { 'content-type': asset.endsWith('.js') ? 'text/javascript' : 'text/css' }); res.end(data) }
    catch { res.writeHead(404); res.end() }
    return
  }
  const html = await readFile(path.join(webDist, 'index.html'), 'utf8')
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(html.replace('</body>', `${browserScript}</body>`))
})

let browserScript = ''
let prisma: (typeof import('../../src/config/prisma'))['prisma'] | undefined
let originalAnswer: (typeof import('../../src/modules/groundedAnswers/groundedAnswers.service'))['groundedAnswersService']['answerQuestion'] | undefined
try {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  process.env.CLIENT_URL = origin
  ;({ prisma } = await import('../../src/config/prisma'))
  const { sha256Hex } = await import('../../src/utils/crypto')
  const { groundedAnswersService } = await import('../../src/modules/groundedAnswers/groundedAnswers.service')
  originalAnswer = groundedAnswersService.answerQuestion
  const password = 'DraftBrowserPassword1'
  const passwordHash = await bcrypt.hash(password, 4)
  const organization = await prisma.organization.create({ data: { name: 'Draft browser fixture', slug: 'draft-browser-fixture' } })
  const [rep, manager] = await Promise.all([
    prisma.user.create({ data: { organizationId: organization.id, email: 'draft-browser-rep@test.invalid', passwordHash, firstName: 'Draft', lastName: 'Rep', role: 'REP' } }),
    prisma.user.create({ data: { organizationId: organization.id, email: 'draft-browser-manager@test.invalid', passwordHash, firstName: 'Draft', lastName: 'Manager', role: 'MANAGER' } }),
  ])
  const document = await prisma.document.create({ data: {
    filename: 'policy.txt', displayName: 'Policy', mimeType: 'text/plain', sizeBytes: 40, fileType: 'TXT',
    storagePath: '/disposable/policy.txt', tags: [], status: 'COMPLETED', nextVersionNumber: 2,
    organizationId: organization.id, uploadedById: rep.id,
  } })
  const version = await prisma.documentVersion.create({ data: {
    documentId: document.id, organizationId: organization.id, versionNumber: 1,
    filename: document.filename, mimeType: document.mimeType, sizeBytes: document.sizeBytes,
    fileType: document.fileType, storagePath: document.storagePath, contentHash: sha256Hex('policy'),
    status: 'ACTIVE', publishedAt: new Date(),
  } })
  await prisma.documentChunk.createMany({ data: Array.from({ length: 120 }, (_, chunkIndex) => ({
    documentId: document.id, versionId: version.id, chunkIndex, text: `Other passage ${chunkIndex}.`,
    tokenCount: 4, headingPath: [],
  })) })
  const chunk = await prisma.documentChunk.create({ data: {
    documentId: document.id, versionId: version.id, chunkIndex: 120,
    text: 'Refunds within thirty days. <img src=x onerror=alert(1)>', tokenCount: 12, headingPath: [],
  } })
  await prisma.document.update({ where: { id: document.id }, data: { activeVersionId: version.id } })
  groundedAnswersService.answerQuestion = (async () => ({
    answer: 'Refunds are allowed within thirty days.', refused: false, confidence: 'LOW', reviewRequired: true,
    aiInteractionId: 'draft-browser-fixture', citations: [{ documentId: document.id, documentName: document.displayName,
      filename: document.filename, versionId: version.id, chunkId: chunk.id, chunkIndex: 120,
      pageNumber: null, headingPath: [], sectionTitle: null, score: 1, snippet: chunk.text }],
  })) as typeof groundedAnswersService.answerQuestion
  const { createApp } = await import('../../src/app')
  app = createApp()
  const repToken = jwt.sign({ sub: rep.id, organizationId: organization.id, email: rep.email, role: rep.role }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '10m' })
  async function apiRequest(method: string, route: string, body: unknown) {
    const response = await fetch(`${origin}/api/v1${route}`, { method,
      headers: { authorization: `Bearer ${repToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const envelope = await response.json() as { data: any; message: string }
    assert.ok(response.ok, envelope.message)
    return envelope.data
  }
  const draft = await apiRequest('POST', '/drafts', { idempotencyKey: 'draft-browser-seed', question: 'What is the refund policy?', documentIds: [document.id] })
  concurrentEdit = async () => { const current = await apiRequest('GET', `/drafts/${draft.id}`, undefined); await apiRequest('POST', `/drafts/${draft.id}/revisions`, { expectedRevisionId: current.currentRevisionId, content: 'Concurrent teammate update.' }) }
  reviewEdit = async () => { const answers = await apiRequest('GET', '/approved-answers', undefined); assert.equal(answers.length, 1); await apiRequest('POST', `/approved-answers/${answers[0].id}/revisions`, { expectedRevisionId: answers[0].currentRevisionId, content: 'Reviewed library correction.' }) }
  browserScript = `<script>
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } });
    (async () => {
      const waitFor = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out at ' + location.pathname + ': ' + document.querySelector('#root')?.innerText?.slice(0, 2500)); };
      const click = label => { const node = [...document.querySelectorAll('#root button,#root a')].find(item => item.textContent.trim() === label); if (!node) throw new Error('Missing ' + label); node.click(); };
      const setText = (node, value) => { const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); };
      try {
        if (sessionStorage.getItem('stage') === 'reload') {
          await waitFor(() => document.querySelector('#draft-reply'));
          if (document.querySelector('#draft-reply').value !== 'Reviewed correction.') throw new Error('Saved text did not survive reload');
          if (!document.querySelector('#root').innerText.includes('Review required')) throw new Error('Edit kept approval');
          const queued = await fetch('/__queue', { method: 'POST' }); if (!queued.ok) throw new Error('Library queue setup failed');
          click('Approved answers library');
          await waitFor(() => [...document.querySelectorAll('#root button')].some(node => node.textContent.trim() === 'Inspect current revision'));
          click('Inspect current revision');
          await waitFor(() => [...document.querySelectorAll('#root button')].some(node => node.textContent.trim() === 'Approve inspected revision'));
          if (!document.querySelector('#root').innerText.includes('Reviewed library correction.')) throw new Error('Edited library revision not shown');
          click('Approve inspected revision');
          await waitFor(() => document.querySelector('#root').innerText.includes('Current library revision approved.'));
          click('Reuse as new draft');
          await waitFor(() => document.querySelector('#root').innerText.includes('Started from an approved answer. This draft is unapproved'));
          if (!document.querySelector('#root').innerText.includes('Review required')) throw new Error('Reuse inherited approval');
          await fetch('/__result', { method: 'POST', body: JSON.stringify({ ok: true }) }); return;
        }
        await waitFor(() => document.querySelector('input[type=email]'));
        setText(document.querySelector('input[type=email]'), 'draft-browser-manager@test.invalid');
        setText(document.querySelector('input[type=password]'), 'DraftBrowserPassword1');
        click('Sign in');
        await waitFor(() => [...document.querySelectorAll('#root a')].some(node => node.textContent.trim() === 'Draft a reply'));
        click('Draft a reply');
        await waitFor(() => document.querySelector('#buyer-question'));
        setText(document.querySelector('#buyer-question'), 'Can we issue a refund?');
        click('Create saved draft');
        await waitFor(() => document.querySelector('#draft-reply'));
        sessionStorage.setItem('stage', 'review'); location.href = '/draft/${draft.id}';
      } catch (error) { await fetch('/__result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error) }) }); }
    })();
  </script>`
  browserScript = browserScript.replace("if (sessionStorage.getItem('stage') === 'reload')", `if (sessionStorage.getItem('stage') === 'review') {
      await waitFor(() => document.querySelector('#draft-reply'));
      if (!document.querySelector('#root').innerText.includes('Refunds within thirty days.')) throw new Error('Source context missing');
      if (document.querySelector('#root img')) throw new Error('Source HTML was executed');
      click('Approve current revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Approved current revision'));
      click('Copy saved revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Copied. Delivery is not recorded'));
      click('Save to approved answers');
      await waitFor(() => document.querySelector('#root').innerText.includes('Saved to approved answers.'));
      setText(document.querySelector('#draft-reply'), 'Reviewed correction.');
      window.confirm = () => false; click('Approved answers library'); await new Promise(resolve => setTimeout(resolve, 100));
      if (location.pathname !== '/draft/${draft.id}') throw new Error('Unsaved navigation not blocked');
      const conflict = await fetch('/__concurrent', { method: 'POST' }); if (!conflict.ok) throw new Error('Concurrent edit setup failed');
      click('Save revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Draft changed; reload the current revision before saving'));
      if (document.querySelector('#draft-reply').value !== 'Reviewed correction.') throw new Error('Conflict discarded local text');
      window.confirm = () => true; click('Reload current revision');
      await waitFor(() => document.querySelector('#draft-reply')?.value === 'Concurrent teammate update.');
      setText(document.querySelector('#draft-reply'), 'Reviewed correction.'); click('Save revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Saved. This revision needs review again.'));
      sessionStorage.setItem('stage', 'reload'); location.reload(); return;
    }
    if (sessionStorage.getItem('stage') === 'reload')`)
  browser = spawn('firefox', ['--headless', '--no-remote', '--profile', profile, `${origin}/login`], { stdio: 'ignore' })
  await Promise.race([completed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Firefox draft API journey timed out')), 60_000) })])
  assert.deepEqual(result, { ok: true }, result?.error)
  const saved = await prisma.draft.findUniqueOrThrow({ where: { id: draft.id }, include: { revisions: { orderBy: { revisionNumber: 'desc' } } } })
  assert.equal(saved.revisions[0].content, 'Reviewed correction.')
  assert.equal(saved.reviewStatus, 'REQUIRED')
  assert.equal(saved.deliveryStatus, 'NOT_REQUESTED')
  assert.ok(saved.revisions.length >= 3)
  assert.equal(await prisma.draft.count({ where: { organizationId: organization.id, authorId: manager.id, reusedApprovedAnswerId: null } }), 1)
  assert.equal(await prisma.draftCopyConfirmation.count({ where: { export: { draftId: draft.id } } }), 1)
  const answer = await prisma.approvedAnswer.findFirstOrThrow({ where: { organizationId: organization.id } })
  assert.equal(answer.reviewStatus, 'APPROVED')
  assert.equal((await prisma.approvedAnswerRevision.findUniqueOrThrow({ where: { id: answer.currentRevisionId! } })).content, 'Reviewed library correction.')
  const reused = await prisma.draft.findFirstOrThrow({ where: { organizationId: organization.id, reusedApprovedAnswerId: answer.id } })
  assert.equal(reused.reviewStatus, 'REQUIRED')
  assert.equal(reused.reusedApprovedAnswerRevisionId, answer.currentRevisionId)
  await prisma.documentVersion.update({ where: { id: version.id }, data: { status: 'RETIRED' } })
  await prisma.document.update({ where: { id: document.id }, data: { activeVersionId: null } })
  const retiredSource = await apiRequest('GET', `/documents/${document.id}/versions/${version.id}/source?chunkId=${chunk.id}`, undefined)
  assert.equal(retiredSource.availability, 'STALE')
  assert.deepEqual(retiredSource.chunks, [])
  console.log('PASS Firefox 10A/10B real API and disposable SQL: login, create, source, approve, copy, conflict, reload, library reuse')
} finally {
  clearTimeout(timeout)
  browser?.kill('SIGTERM')
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(profile, { recursive: true, force: true })
  if (prisma) await prisma.$disconnect()
}
