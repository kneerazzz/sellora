/** Browser acceptance against this runner's migrated disposable database and real API. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
await writeFile(path.join(profile, 'user.js'), 'user_pref("dom.disable_open_during_load", false);\n')
const storage = await mkdtemp(path.join(tmpdir(), 'sellora-drafts-real-documents-'))
const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0)
const embeddingStub = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const input = JSON.parse(body) as { model: string; prompt: string }
  assert.equal(req.url, '/api/embeddings')
  assert.equal(input.model, 'nomic-embed-text')
  assert.ok(input.prompt.startsWith('search_document: '))
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ embedding: vector }))
})
embeddingStub.listen(0, '127.0.0.1')
await once(embeddingStub, 'listening')
const embeddingAddress = embeddingStub.address()
assert.ok(embeddingAddress && typeof embeddingAddress === 'object')
Object.assign(process.env, { DOCUMENT_STORAGE_DIR: storage, EMBEDDING_PROVIDER: 'local', LOCAL_EMBEDDING_SERVICE_URL: `http://127.0.0.1:${embeddingAddress.port}` })
let app: ReturnType<typeof import('../../src/app').createApp> | undefined
let browser: ReturnType<typeof spawn> | undefined
let timeout: ReturnType<typeof setTimeout> | undefined
let result: { ok: boolean; error?: string } | undefined
let finish!: () => void
const completed = new Promise<void>(resolve => { finish = resolve })
let reviewEdit: (() => Promise<void>) | undefined
let expireSession: (() => Promise<void>) | undefined
let retireSource: (() => Promise<void>) | undefined
let saveFailure = false
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  if (saveFailure && req.method === 'POST' && /\/api\/v1\/drafts\/[^/]+\/revisions$/.test(pathname)) {
    saveFailure = false
    res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ message: 'Temporary save failure' }))
    return
  }
  if (pathname.startsWith('/api/')) return app!(req, res)
  if (pathname === '/__fail-save' && req.method === 'POST') { saveFailure = true; res.writeHead(204).end(); return }
  if (pathname === '/__queue' && req.method === 'POST') {
    try { await reviewEdit!(); res.writeHead(204); res.end() }
    catch { res.writeHead(500); res.end() }
    return
  }
  if (pathname === '/__expire' && req.method === 'POST') { await expireSession!(); res.writeHead(204).end(); return }
  if (pathname === '/__retire' && req.method === 'POST') { await retireSource!(); res.writeHead(204).end(); return }
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
    text: 'Refunds within thirty days. <img src=x onerror=alert(1)> ' + 'Long policy passage. '.repeat(250), tokenCount: 1012, headingPath: [],
  } })
  await prisma.document.update({ where: { id: document.id }, data: { activeVersionId: version.id } })
  groundedAnswersService.answerQuestion = (async ({ question }) => ({
    answer: question.includes('unsupported') ? 'I cannot answer from the available sources.' : 'Refunds are allowed within thirty days.',
    refused: question.includes('unsupported'), confidence: 'LOW', reviewRequired: true,
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
  reviewEdit = async () => { const answers = await apiRequest('GET', '/approved-answers', undefined); assert.equal(answers.length, 1); await apiRequest('POST', `/approved-answers/${answers[0].id}/revisions`, { expectedRevisionId: answers[0].currentRevisionId, content: 'Reviewed library correction.' }) }
  expireSession = async () => { await prisma!.refreshToken.updateMany({ where: { userId: manager.id }, data: { isRevoked: true } }) }
  retireSource = async () => { await prisma!.documentVersion.update({ where: { id: version.id }, data: { status: 'RETIRED' } }); await prisma!.document.update({ where: { id: document.id }, data: { activeVersionId: null } }) }
  browserScript = `<script>
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } });
    (async () => {
      const waitFor = async predicate => { for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out at ' + location.pathname + ': ' + document.querySelector('#root')?.innerText?.slice(0, 2500)); };
      const click = label => { const node = [...document.querySelectorAll('#root button,#root a')].find(item => item.textContent.trim() === label); if (!node) throw new Error('Missing ' + label); node.click(); };
      const setText = (node, value) => { const proto = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); };
      try {
        if (new URLSearchParams(location.search).has('secondTab')) {
          await waitFor(() => document.querySelector('#draft-reply'));
          setText(document.querySelector('#draft-reply'), 'Concurrent teammate update.'); click('Save revision');
          await waitFor(() => document.querySelector('#root').innerText.includes('Saved. This revision needs review again.'));
          window.opener?.postMessage('second-tab-saved', location.origin); window.close(); return;
        }
        if (sessionStorage.getItem('stage') === 'expired') {
          await waitFor(() => document.querySelector('input[type=email]'));
          if (location.pathname !== '/login') throw new Error('Expired session did not return to login');
          setText(document.querySelector('input[type=email]'), 'draft-browser-manager@test.invalid');
          setText(document.querySelector('input[type=password]'), 'DraftBrowserPassword1');
          click('Sign in');
          await waitFor(() => document.querySelector('#draft-reply'));
          if (!document.querySelector('#root').innerText.includes('Source unavailable') && !document.querySelector('#root').innerText.includes('stale')) throw new Error('Reopened draft lost source state');
          document.querySelector('button[aria-label="Log out"]').click(); await waitFor(() => document.querySelector('input[type=email]'));
          setText(document.querySelector('input[type=email]'), 'draft-browser-rep@test.invalid');
          setText(document.querySelector('input[type=password]'), 'DraftBrowserPassword1'); click('Sign in');
          await waitFor(() => document.querySelector('nav a[aria-label="Settings"]'));
          location.href = '/settings/api-keys'; sessionStorage.setItem('stage', 'rep-settings'); return;
        }
        if (sessionStorage.getItem('stage') === 'rep-settings') {
          await waitFor(() => location.pathname === '/settings');
          if ([...document.querySelectorAll('#root a')].some(node => node.textContent.trim() === 'API keys')) throw new Error('REP sees API keys');
          await fetch('/__result', { method: 'POST', body: JSON.stringify({ ok: true }) }); return;
        }
        if (sessionStorage.getItem('stage') === 'reload') {
          await waitFor(() => document.querySelector('#draft-reply'));
          if (document.querySelector('#draft-reply').value !== 'Reviewed correction.') throw new Error('Saved text did not survive reload');
          if (!document.querySelector('#root').innerText.includes('Review required')) throw new Error('Edit kept approval');
          navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied') };
          click('Copy saved revision');
          await waitFor(() => document.querySelector('#root').innerText.includes('Could not copy or record clipboard success'));
          navigator.clipboard.writeText = async () => {};
          const queued = await fetch('/__queue', { method: 'POST' }); if (!queued.ok) throw new Error('Library queue setup failed');
          click('Approved answers library');
          await waitFor(() => [...document.querySelectorAll('#root button')].some(node => node.textContent.trim() === 'Inspect current revision'));
          click('Inspect current revision');
          await waitFor(() => [...document.querySelectorAll('#root button')].some(node => node.textContent.trim() === 'Approve inspected revision'));
          if (!document.querySelector('#root').innerText.includes('Reviewed library correction.')) throw new Error('Edited library revision not shown');
          click('Approve inspected revision');
          await waitFor(() => document.querySelector('#root').innerText.includes('Current library revision approved.'));
          await waitFor(() => { const button = [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Reuse as new draft'); return button && !button.disabled; });
          click('Reuse as new draft');
          await waitFor(() => document.querySelector('#root').innerText.includes('Started from an approved answer. This draft is unapproved'));
          if (!document.querySelector('#root').innerText.includes('Review required')) throw new Error('Reuse inherited approval');
          click('Drafts'); await waitFor(() => document.querySelector('#buyer-question'));
          setText(document.querySelector('#buyer-question'), 'This unsupported question needs refusal'); click('Create saved draft');
          await waitFor(() => document.querySelector('#root').innerText.includes('More information needed'));
          if (![...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Approve current revision')?.disabled) throw new Error('Refusal could be approved');
          await fetch('/__retire', { method: 'POST' }); location.href = '/draft/${draft.id}'; sessionStorage.setItem('stage', 'stale'); return;
        }
        if (sessionStorage.getItem('stage') === 'stale') {
          await waitFor(() => document.querySelector('#draft-reply'));
          if (!document.querySelector('#root').innerText.toLowerCase().includes('stale')) throw new Error('Stale source was not marked');
          if (document.querySelector('#root').innerText.includes('Long policy passage.')) throw new Error('Stale passage was exposed');
          await fetch('/__expire', { method: 'POST' }); sessionStorage.setItem('stage', 'expired'); location.reload(); return;
        }
        await waitFor(() => document.querySelector('input[type=email]'));
        if (innerWidth > 500 || document.documentElement.scrollWidth > innerWidth + 1) throw new Error('Login layout exceeds small viewport');
        for (const input of document.querySelectorAll('input[type=email],input[type=password]')) if (!input.labels?.length) throw new Error('Login field lacks label');
        setText(document.querySelector('input[type=email]'), 'draft-browser-manager@test.invalid');
        setText(document.querySelector('input[type=password]'), 'DraftBrowserPassword1');
        click('Sign in');
        await waitFor(() => [...document.querySelectorAll('#root a')].some(node => node.textContent.trim() === 'Knowledge'));
        for (const label of ['Drafts', 'Knowledge', 'Approved answers', 'Activity', 'Settings']) {
          const link = [...document.querySelectorAll('nav a')].find(node => node.getAttribute('aria-label') === label && node.getClientRects().length);
          if (!link) throw new Error('Missing navigation ' + label);
          link.focus(); if (document.activeElement !== link) throw new Error('Navigation focus failed: ' + label);
        }
        click('Knowledge');
        await waitFor(() => document.querySelector('input[type=file]'));
        const transfer = new DataTransfer(); transfer.items.add(new File(['# Upload policy\\n\\nRefunds within thirty days.'], 'browser-policy.md', { type: 'text/markdown' }));
        const upload = document.querySelector('input[type=file]'); upload.files = transfer.files; upload.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => document.querySelector('#root').innerText.includes('browser-policy.md'));
        click('Drafts');
        await waitFor(() => document.querySelector('#buyer-question'));
        if (!document.querySelector('#buyer-question').labels?.length) throw new Error('Buyer question lacks label');
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
      if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('Long source overflows small viewport');
      click('Approve current revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Approved current revision'));
      click('Copy saved revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Copied. Delivery is not recorded'));
      click('Save to approved answers');
      await waitFor(() => document.querySelector('#root').innerText.includes('Saved to approved answers.'));
      setText(document.querySelector('#draft-reply'), 'Reviewed correction.');
      window.confirm = () => false; click('Approved answers library'); await new Promise(resolve => setTimeout(resolve, 100));
      if (location.pathname !== '/draft/${draft.id}') throw new Error('Unsaved navigation not blocked');
      const fail = await fetch('/__fail-save', { method: 'POST' }); if (!fail.ok) throw new Error('Save failure setup failed');
      click('Save revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Temporary save failure'));
      if (document.querySelector('#draft-reply').value !== 'Reviewed correction.') throw new Error('Save failure discarded local text');
      const secondSaved = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Second tab timed out')), 10000); addEventListener('message', event => { if (event.origin === location.origin && event.data === 'second-tab-saved') { clearTimeout(timer); resolve(); } }, { once: true }); });
      if (!window.open('/draft/${draft.id}?secondTab=1', '_blank')) throw new Error('Second tab could not open');
      await secondSaved;
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
  browser = spawn('firefox', ['--headless', '--no-remote', '--width', '390', '--height', '800', '--profile', profile, `${origin}/login`], { stdio: 'ignore' })
  await Promise.race([completed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Firefox draft API journey timed out')), 60_000) })])
  assert.deepEqual(result, { ok: true }, result?.error)
  const saved = await prisma.draft.findUniqueOrThrow({ where: { id: draft.id }, include: { revisions: { orderBy: { revisionNumber: 'desc' } } } })
  assert.equal(saved.revisions[0].content, 'Reviewed correction.')
  assert.equal(saved.reviewStatus, 'REQUIRED')
  assert.equal(saved.deliveryStatus, 'NOT_REQUESTED')
  assert.ok(saved.revisions.length >= 3)
  assert.equal(saved.currentRevisionId, saved.revisions[0]?.id)
  const approval = await prisma.draftApproval.findFirstOrThrow({ where: { draftId: draft.id, decision: 'APPROVED' } })
  assert.equal(approval.revisionId, saved.revisions.find(revision => revision.revisionNumber === 1)?.id)
  const exports = await prisma.draftExportRequest.findMany({ where: { draftId: draft.id }, include: { confirmations: true } })
  assert.equal(exports.filter(item => item.confirmations.length === 1).length, 1)
  assert.ok(exports.every(item => item.revisionId === approval.revisionId || item.revisionId === saved.revisions.find(revision => revision.revisionNumber === 3)?.id))
  assert.equal(await prisma.draft.count({ where: { organizationId: organization.id, authorId: manager.id, reusedApprovedAnswerId: null } }), 2)
  const refusal = await prisma.draft.findFirstOrThrow({ where: { organizationId: organization.id, authorId: manager.id, question: { contains: 'unsupported' } }, include: { revisions: true } })
  assert.equal(refusal.revisions[0]?.isRefusal, true)
  assert.equal(refusal.reviewStatus, 'REQUIRED')
  assert.equal(await prisma.document.count({ where: { organizationId: organization.id, filename: 'browser-policy.md', status: 'COMPLETED' } }), 1)
  assert.equal(await prisma.draftCopyConfirmation.count({ where: { export: { draftId: draft.id } } }), 1)
  const answer = await prisma.approvedAnswer.findFirstOrThrow({ where: { organizationId: organization.id } })
  assert.equal(answer.reviewStatus, 'APPROVED')
  assert.equal((await prisma.approvedAnswerRevision.findUniqueOrThrow({ where: { id: answer.currentRevisionId! } })).content, 'Reviewed library correction.')
  const reused = await prisma.draft.findFirstOrThrow({ where: { organizationId: organization.id, reusedApprovedAnswerId: answer.id } })
  assert.equal(reused.reviewStatus, 'REQUIRED')
  assert.equal(reused.reusedApprovedAnswerRevisionId, answer.currentRevisionId)
  const deniedApproval = await fetch(`${origin}/api/v1/drafts/${draft.id}/approvals`, { method: 'POST', headers: { authorization: `Bearer ${repToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ revisionId: saved.currentRevisionId }) })
  assert.equal(deniedApproval.status, 403)
  const deniedKeys = await fetch(`${origin}/api/v1/api-keys`, { headers: { authorization: `Bearer ${repToken}` } })
  assert.equal(deniedKeys.status, 403)
  await prisma.documentVersion.update({ where: { id: version.id }, data: { status: 'RETIRED' } })
  await prisma.document.update({ where: { id: document.id }, data: { activeVersionId: null } })
  const retiredSource = await apiRequest('GET', `/documents/${document.id}/versions/${version.id}/source?chunkId=${chunk.id}`, undefined)
  assert.equal(retiredSource.availability, 'STALE')
  assert.deepEqual(retiredSource.chunks, [])
  console.log('PASS Firefox 10C/10D real API and disposable SQL: navigation, upload, draft/source/approval/copy/reopen, failure paths, two tabs, role denial, mobile focus')
} finally {
  clearTimeout(timeout)
  browser?.kill('SIGTERM')
  server.closeAllConnections()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await rm(profile, { recursive: true, force: true })
  await rm(storage, { recursive: true, force: true })
  await new Promise<void>(resolve => embeddingStub.close(() => resolve()))
  if (prisma) await prisma.$disconnect()
}
