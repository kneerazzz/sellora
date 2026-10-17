/** Browser acceptance for persistent drafts and approved-answer reuse against a deterministic loopback API. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const profile = await mkdtemp(path.join(tmpdir(), 'sellora-drafts-browser-'))
const now = new Date().toISOString()
const user = { id: 'reviewer', organizationId: 'org', email: 'browser@test.invalid', firstName: 'Browser', lastName: 'Reviewer', role: 'ADMIN' }
const source = { documentId: 'doc', versionId: 'version', chunkId: 'chunk', availability: 'CURRENT', displayName: 'Policy', filename: 'policy.txt', chunkIndex: 0, pageNumber: null, headingPath: [], sectionTitle: 'Access' }
const revision = (id, number, content, authorId = 'author') => ({ id, createdAt: now, revisionNumber: number, content, origin: number === 1 ? 'GENERATED' : 'MANUAL', isRefusal: false, aiInteractionId: null, author: { id: authorId, firstName: 'Draft', lastName: 'Author' }, sources: [{ id: `source-${number}`, ordinal: 0, ...source }] })
let draft = { id: 'draft', createdAt: now, updatedAt: now, title: null, question: 'Which access controls are supported?', requestedDocumentIds: ['doc'], processingStatus: 'COMPLETED', reviewStatus: 'REQUIRED', deliveryStatus: 'NOT_REQUESTED', generationErrorCode: null, currentRevisionId: 'revision-1', concurrencyToken: 1, archivedAt: null, reusedApprovedAnswerId: null, reusedApprovedAnswerRevisionId: null, author: { id: 'author', firstName: 'Draft', lastName: 'Author' }, revisions: [revision('revision-1', 1, 'Access is controlled by roles.')], approvals: [] }
let approvedAnswer = { id: 'answer', title: 'Access controls', question: draft.question, tags: [], reviewStatus: 'APPROVED', currentRevisionId: 'answer-revision', concurrencyToken: 1, archivedAt: null, eligibility: 'CURRENT', currentRevision: { id: 'answer-revision', revisionNumber: 1, content: 'Access is controlled by roles.', createdAt: now }, revisions: [{ id: 'answer-revision', revisionNumber: 1, title: 'Access controls', question: draft.question, content: 'Access is controlled by roles.', createdAt: now, sources: [source] }] }
let queue = [{ id: 'answer-review', title: 'Updated answer', question: draft.question, currentRevisionId: 'review-revision', reviewStatus: 'REQUIRED', reasons: [{ code: 'ANSWER_EDITED' }] }]
const reviewAnswer = { ...approvedAnswer, id: 'answer-review', title: 'Updated answer', reviewStatus: 'REQUIRED', currentRevisionId: 'review-revision', eligibility: 'REVIEW_REQUIRED', currentRevision: { id: 'review-revision', revisionNumber: 2, content: 'Updated answer.', createdAt: now }, revisions: [{ id: 'review-revision', revisionNumber: 2, title: 'Updated answer', question: draft.question, content: 'Updated answer.', createdAt: now, sources: [source] }] }
let copied = 0
let failNextSave = true
let result
const requests = []
let finish
let timeout
const completed = new Promise(resolve => { finish = resolve })
const response = (data, meta) => JSON.stringify({ success: true, statusCode: 200, message: 'Fixture', data, ...(meta && { meta }) })
const readBody = async req => { let body = ''; for await (const chunk of req) body += chunk; return body ? JSON.parse(body) : {} }
const testScript = `<script>
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => {} } });
  (async () => {
    const waitFor = async predicate => { for (let i = 0; i < 120; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('Timed out: ' + document.querySelector('#root')?.innerText?.slice(0, 500)); };
    const click = label => { const node = [...document.querySelectorAll('#root button,#root a')].find(item => item.textContent.trim() === label); if (!node) throw new Error('Missing ' + label); node.click(); };
    const setText = (node, value) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); };
    try {
      if (sessionStorage.getItem('stage') === 'reload') {
        await waitFor(() => document.querySelector('#draft-reply'));
        if (document.querySelector('#draft-reply').value !== 'Updated after review.') throw new Error('Saved revision did not survive reload');
        click('Approved answers library');
        await waitFor(() => [...document.querySelectorAll('#root button')].some(node => node.textContent.trim() === 'Reuse as new draft'));
        click('Inspect current revision');
        await waitFor(() => [...document.querySelectorAll('#root button')].some(node => node.textContent.trim() === 'Approve inspected revision'));
        click('Approve inspected revision');
        await waitFor(() => document.querySelector('#root').innerText.includes('Current library revision approved.'));
        click('Reuse as new draft');
        await waitFor(() => document.querySelector('#root').innerText.includes('Started from an approved answer. This draft is unapproved'));
        if (!document.querySelector('#root').innerText.includes('Review required')) throw new Error('Reuse inherited approval');
        await fetch('/__result', { method: 'POST', body: JSON.stringify({ ok: true }) }); return;
      }
      await waitFor(() => document.querySelector('#buyer-question'));
      setText(document.querySelector('#buyer-question'), 'Which access controls are supported?');
      click('Create saved draft');
      await waitFor(() => document.querySelector('#draft-reply'));
      if (!document.querySelector('#root').innerText.includes('Access is controlled by roles.')) throw new Error('Saved answer missing');
      if (document.querySelector('#root img')) throw new Error('Source text rendered as HTML');
      click('Approve current revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Approved current revision'));
      click('Copy saved revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Copied. Delivery is not recorded'));
      click('Save to approved answers');
      await waitFor(() => document.querySelector('#root').innerText.includes('Saved to approved answers.'));
      setText(document.querySelector('#draft-reply'), 'Updated after review.');
      window.confirm = () => false; click('Approved answers library'); await new Promise(resolve => setTimeout(resolve, 200));
      if (location.pathname !== '/draft/draft') throw new Error('Unsaved navigation was not blocked');
      click('Save revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Draft changed; reload the current revision before saving'));
      if (document.querySelector('#draft-reply').value !== 'Updated after review.') throw new Error('Save conflict discarded local edits');
      window.confirm = () => true; click('Reload current revision');
      await waitFor(() => document.querySelector('#draft-reply')?.value === 'Concurrent teammate update.');
      setText(document.querySelector('#draft-reply'), 'Updated after review.');
      click('Save revision');
      await waitFor(() => document.querySelector('#root').innerText.includes('Saved. This revision needs review again.'));
      if (!document.querySelector('#root').innerText.includes('Review required')) throw new Error('Editing retained approval');
      sessionStorage.setItem('stage', 'reload'); window.location.reload();
    } catch (error) { await fetch('/__result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), page: document.body.textContent.slice(0, 250) }) }); }
  })();
</script>`
const server = createServer(async (req, res) => {
  const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(body) }
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname
  requests.push(`${req.method} ${pathname}`)
  if (pathname === '/__result' && req.method === 'POST') { result = await readBody(req); send(200, '{}'); finish(); return }
  if (pathname === '/api/v1/auth/refresh') return send(200, response({ user, accessToken: 'synthetic-browser-token' }))
  if (pathname === '/api/v1/users/me') return send(200, response(user))
  if (pathname === '/api/v1/drafts' && req.method === 'GET') return send(200, response([draft]))
  if (pathname === '/api/v1/drafts' && req.method === 'POST') { draft = { ...draft, question: (await readBody(req)).question }; return send(201, response(draft)) }
  if (/^\/api\/v1\/drafts\/(draft|reused-draft)$/.test(pathname) && req.method === 'GET') return send(200, response(draft))
  if (pathname === '/api/v1/drafts/draft/approvals' && req.method === 'POST') { await readBody(req); draft = { ...draft, reviewStatus: 'APPROVED', approvals: [{ id: 'approval', createdAt: now, decision: 'APPROVED', note: null, revisionId: draft.currentRevisionId, reviewer: user }] }; return send(200, response(draft)) }
  if (pathname === '/api/v1/drafts/draft/revisions' && req.method === 'POST') {
    const input = await readBody(req)
    if (failNextSave) { failNextSave = false; draft = { ...draft, currentRevisionId: 'revision-2', concurrencyToken: 2, reviewStatus: 'REQUIRED', updatedAt: now, revisions: [revision('revision-2', 2, 'Concurrent teammate update.', 'teammate'), ...draft.revisions] }; return send(409, JSON.stringify({ success: false, statusCode: 409, message: 'Draft changed; reload the current revision before saving', errors: [] })) }
    draft = { ...draft, currentRevisionId: 'revision-3', concurrencyToken: 3, reviewStatus: 'REQUIRED', updatedAt: now, revisions: [revision('revision-3', 3, input.content, user.id), ...draft.revisions] }
    return send(200, response(draft))
  }
  if (pathname === '/api/v1/drafts/draft/exports' && req.method === 'POST') { await readBody(req); return send(200, response({ exportId: 'export', requestedAt: now, draftId: draft.id, revisionId: draft.currentRevisionId, revisionNumber: 1, approvalStatus: 'APPROVED', sourceStatus: 'CURRENT', archived: false, isRefusal: false, content: draft.revisions[0].content, text: draft.revisions[0].content })) }
  if (pathname === '/api/v1/drafts/draft/exports/export/copied' && req.method === 'POST') { copied += 1; return send(201, response({ id: 'copy', createdAt: now })) }
  if (pathname === '/api/v1/approved-answers' && req.method === 'POST') { await readBody(req); return send(201, response(approvedAnswer)) }
  if (pathname === '/api/v1/approved-answers' && req.method === 'GET') return send(200, response([approvedAnswer]))
  if (pathname === '/api/v1/approved-answers/review-queue') return send(200, response(queue))
  if (pathname === '/api/v1/approved-answers/answer-review' && req.method === 'GET') return send(200, response(reviewAnswer))
  if (pathname === '/api/v1/approved-answers/answer-review/approvals' && req.method === 'POST') { await readBody(req); queue = []; return send(200, response({ ...reviewAnswer, reviewStatus: 'APPROVED' })) }
  if (pathname === '/api/v1/approved-answers/answer/reuse' && req.method === 'POST') { await readBody(req); draft = { ...draft, id: 'reused-draft', reviewStatus: 'REQUIRED', reusedApprovedAnswerId: 'answer', reusedApprovedAnswerRevisionId: 'answer-revision', currentRevisionId: 'revision-1' }; return send(201, response(draft)) }
  if (pathname === '/api/v1/documents/doc/versions/version/source') return send(200, response({ versionId: 'version', versionNumber: 1, availability: 'CURRENT', truncated: false, chunks: [{ id: 'chunk', chunkIndex: 0, text: 'Access is controlled by roles. <img src=x onerror=alert(1)>', pageNumber: null, headingPath: [], sectionTitle: 'Access' }] }))
  if (pathname.startsWith('/assets/')) { const file = path.join(appDir, 'dist', pathname); if (!file.startsWith(path.join(appDir, 'dist', 'assets') + path.sep)) return send(404, ''); try { return send(200, await readFile(file), pathname.endsWith('.js') ? 'text/javascript' : 'text/css') } catch { return send(404, '') } }
  const html = await readFile(path.join(appDir, 'dist/index.html'), 'utf8'); send(200, html.replace('</body>', `${testScript}</body>`), 'text/html')
})

let browser
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  browser = spawn('firefox', ['--headless', '--no-remote', '--profile', profile, `http://127.0.0.1:${address.port}/draft`], { stdio: 'ignore' })
  await Promise.race([completed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Firefox draft check timed out')), 30_000) })])
  assert.equal(result?.ok, true, JSON.stringify({ result, requests }))
  assert.equal(copied, 1)
  console.log('PASS Firefox persistent draft, exact approval/export, library save and unapproved reuse journey against deterministic API')
} finally {
  clearTimeout(timeout); browser?.kill('SIGTERM'); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true })
}
