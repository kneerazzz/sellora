/** Selected Gmail/n8n contract over real API and an explicitly disposable database. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Gmail fixture requires a localhost sellora_test_* target')
}
process.env.DATABASE_URL = target
process.env.NODE_ENV = 'test'

const { prisma } = await import('../../src/config/prisma')
const { sha256Hex } = await import('../../src/utils/crypto')
const { createApp } = await import('../../src/app')
const originalFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  if (new URL(String(input)).hostname !== '127.0.0.1') throw new Error('Unexpected external request in Gmail fixture')
  return originalFetch(input, init)
}
const workflow = JSON.parse(await readFile(new URL('../../../../n8n/sellora-gmail-intake-workflow.json', import.meta.url), 'utf8')) as {
  active: boolean; nodes: Array<{ name: string; type: string; parameters: Record<string, any>; credentials?: unknown }>
}
assert.equal(workflow.active, false)
assert.equal(workflow.nodes.length, 3)
assert.ok(workflow.nodes.every(node => !node.credentials))
const trigger = workflow.nodes.find(node => node.type === 'n8n-nodes-base.gmailTrigger')!
assert.equal(trigger.parameters.simple, false)
assert.equal(trigger.parameters.maxResults, 10)
assert.match(trigger.parameters.filters.q, /-has:attachment/)
const sender = workflow.nodes.find(node => node.type === 'n8n-nodes-base.httpRequest')!
assert.equal(sender.parameters.authentication, 'genericCredentialType')
assert.ok(sender.parameters.url.endsWith('/api/v1/webhooks/gmail-received'))
assert.equal(sender.parameters.jsonBody, '={{ $json }}')
const normalize = workflow.nodes.find(node => node.type === 'n8n-nodes-base.code')!
const mapMessage = (input: unknown) => runInNewContext(`(function () { const $json = input; ${normalize.parameters.jsCode} })()`, { input }) as { json: Record<string, unknown> }
const raw = { id: '18f0a1b2c3d4e5f6', threadId: '18f0a1b2c3d4e5f6',
  from: { value: [{ address: 'buyer@example.test' }] }, to: { value: [{ address: 'pilot@example.test' }] },
  subject: 'Refund policy question', text: 'Can you explain the refund window?', date: new Date().toISOString(), sizeEstimate: 1024 }
const message = mapMessage(raw).json
assert.deepEqual(Object.keys(message), ['version', 'messageId', 'threadId', 'from', 'to', 'subject', 'text', 'messageDate', 'sizeEstimate'])
assert.throws(() => mapMessage({ ...raw, id: undefined }), /required intake fields/)
assert.throws(() => mapMessage({ ...raw, from: raw.to }), /Self-addressed/)
assert.throws(() => mapMessage({ ...raw, sizeEstimate: 131073 }), /intake limit/)

const api = createServer(createApp())
try {
  const [org, foreign] = await Promise.all(['a', 'b'].map(suffix => prisma.organization.create({
    data: { name: `Gmail intake ${suffix}`, slug: `gmail-intake-${suffix}` },
  })))
  const keys = await Promise.all([org, foreign].map(async (organization, index) => {
    const rawKey = `gmail-fixture-key-${index}`
    await prisma.apiKey.create({ data: { organizationId: organization.id, label: 'Gmail fixture',
      scope: 'WEBHOOK_ONLY', keyHash: sha256Hex(rawKey), keyPrefix: 'gmail-fixture' } })
    return rawKey
  }))
  const readOnly = 'gmail-fixture-read-only'
  await prisma.apiKey.create({ data: { organizationId: org.id, label: 'Wrong scope',
    scope: 'READ_ONLY', keyHash: sha256Hex(readOnly), keyPrefix: 'gmail-fixture' } })
  api.listen(0, '127.0.0.1')
  await once(api, 'listening')
  const address = api.address()
  assert.ok(address && typeof address === 'object')
  const endpoint = `http://127.0.0.1:${address.port}/api/v1/webhooks/gmail-received`
  async function post(body: unknown, key?: string, extraHeaders: Record<string, string> = {}, query = '') {
    const response = await fetch(endpoint + query, { method: 'POST', headers: {
      'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }), ...extraHeaders,
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
    return { status: response.status, data: (await response.json() as { data: any }).data }
  }
  assert.equal((await post(message)).status, 401)
  assert.equal((await post(message, readOnly)).status, 403)
  assert.equal((await post({ ...message, organizationId: foreign.id }, keys[0])).status, 403)
  assert.equal((await post({ ...message, source: 'OUTLOOK' }, keys[0])).status, 422)
  assert.equal((await post({ ...message, version: 2 }, keys[0])).status, 422)
  assert.equal((await post({ ...message, threadId: '' }, keys[0])).status, 422)
  assert.equal((await post({ ...message, from: 'not an address' }, keys[0])).status, 422)
  assert.equal((await post({ ...message, from: message.to }, keys[0])).status, 422)
  assert.equal((await post({ ...message, text: 'x'.repeat(16001) }, keys[0])).status, 422)
  assert.equal((await post({ ...message, attachment: 'base64-bytes' }, keys[0])).status, 422)
  assert.equal((await post(message, keys[0], { 'Idempotency-Key': 'override' })).status, 400)
  assert.equal((await post(message, keys[0], {}, '?process=true')).status, 422)

  const first = await post(message, keys[0])
  assert.equal(first.status, 202)
  assert.equal(first.data.version, 1)
  const repeat = await post(message, keys[0])
  assert.equal(repeat.status, 202)
  assert.equal(repeat.data.webhookEventId, first.data.webhookEventId)
  assert.equal(repeat.data.workflowRunId, first.data.workflowRunId)
  assert.equal((await post({ ...message, text: 'Changed text' }, keys[0])).status, 409)
  const other = await post(message, keys[1])
  assert.equal(other.status, 202)
  assert.notEqual(other.data.webhookEventId, first.data.webhookEventId)
  const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: first.data.webhookEventId } })
  assert.equal(event.organizationId, org.id)
  assert.equal(event.source, 'GMAIL')
  assert.equal(event.externalObjectId, raw.id)
  assert.equal(event.apiKeyId, (await prisma.apiKey.findFirstOrThrow({ where: { organizationId: org.id, scope: 'WEBHOOK_ONLY' } })).id)
  assert.equal(await prisma.webhookEvent.count({ where: { organizationId: org.id, source: 'GMAIL' } }), 1)
  assert.equal(await prisma.workflowRun.count({ where: { webhookEventId: event.id, status: 'QUEUED' } }), 1)
  assert.equal(await prisma.aiInteraction.count({ where: { organizationId: org.id } }), 0)
  console.log('PASS Gmail v1 saved n8n mapping, scoped key auth, malformed/oversize/spoof/replay denial and one queued SQL run')

  const owner = await prisma.user.create({ data: { organizationId: org.id, email: 'gmail-fixture@test.invalid',
    passwordHash: 'unused-in-fixture', firstName: 'Gmail', lastName: 'Fixture', role: 'ADMIN' } })
  const document = await prisma.document.create({ data: { organizationId: org.id, uploadedById: owner.id,
    filename: 'policy.txt', displayName: 'Policy', mimeType: 'text/plain', sizeBytes: 20,
    fileType: 'TXT', storagePath: '/disposable/gmail-policy.txt', tags: [], status: 'COMPLETED', nextVersionNumber: 2 } })
  const version = await prisma.documentVersion.create({ data: { organizationId: org.id, documentId: document.id,
    versionNumber: 1, filename: document.filename, mimeType: document.mimeType, sizeBytes: document.sizeBytes,
    fileType: document.fileType, storagePath: document.storagePath, contentHash: sha256Hex('gmail-policy'),
    status: 'ACTIVE', publishedAt: new Date() } })
  const chunk = await prisma.documentChunk.create({ data: { documentId: document.id, versionId: version.id,
    chunkIndex: 0, text: 'Refunds are allowed within thirty days.', tokenCount: 8, headingPath: [] } })
  await prisma.document.update({ where: { id: document.id }, data: { activeVersionId: version.id } })
  const { aiExtractionsService } = await import('../../src/modules/aiExtractions/aiExtractions.service')
  const { groundedAnswersService } = await import('../../src/modules/groundedAnswers/groundedAnswers.service')
  const { workflowRunsService } = await import('../../src/modules/workflowRuns/workflowRuns.service')
  const { claimWorkflow } = await import('../../src/modules/workflowRuns/workflowLease')
  const { createGmailReviewTask } = await import('../../src/modules/drafts/gmailReviewTask')
  let failExtraction = true
  let failAnswer = false
  aiExtractionsService.extractSalesEvent = (async (input: { subject?: string }) => {
    if (input.subject === 'Fail fixture' && failExtraction) throw new Error('Synthetic extraction outage')
    return { aiInteractionId: 'synthetic-extraction', extraction: {
      summary: 'Fixture', nextSteps: [], buyerQuestions: input.subject === 'No question' ? [] : ['What is the refund window?'],
      objections: [], riskFlags: [], crmUpdate: { stage: null, lastActivitySummary: null,
        nextFollowUpAt: null, priority: null }, confidence: 'HIGH', confidenceReason: 'fixture',
    } }
  }) as typeof aiExtractionsService.extractSalesEvent
  groundedAnswersService.answerQuestion = (async () => {
    if (failAnswer) throw new Error('Synthetic answer outage')
    return { answer: 'Refunds are allowed within thirty days.',
    refused: false, confidence: 'LOW', reviewRequired: true, aiInteractionId: 'synthetic-answer',
    citations: [{ documentId: document.id, versionId: version.id, chunkId: chunk.id,
      documentName: document.displayName, filename: document.filename, chunkIndex: 0,
      pageNumber: null, headingPath: [], sectionTitle: null, score: 1, snippet: chunk.text }],
    }
  }) as typeof groundedAnswersService.answerQuestion

  await Promise.all([workflowRunsService.processWorkflowRun({ workflowRunId: first.data.workflowRunId,
    organizationId: org.id }), workflowRunsService.processWorkflowRun({ workflowRunId: first.data.workflowRunId,
    organizationId: org.id })])
  const completed = await prisma.workflowRun.findUniqueOrThrow({ where: { id: first.data.workflowRunId } })
  assert.equal(completed.status, 'COMPLETED')
  assert.equal(completed.reviewStatus, 'REQUIRED')
  const draftId = (completed.output as { draftId: string }).draftId
  const draft = await prisma.draft.findUniqueOrThrow({ where: { id: draftId }, include: { revisions: { include: { sources: true } } } })
  assert.equal(draft.authorId, null)
  assert.equal(draft.deliveryStatus, 'NOT_REQUESTED')
  assert.equal(draft.revisions.length, 1)
  assert.equal(draft.revisions[0]!.sources[0]!.chunkId, chunk.id)
  assert.equal((await post(message, keys[0])).data.workflowRunId, first.data.workflowRunId)
  assert.equal(await prisma.draft.count({ where: { organizationId: org.id, idempotencyKey: `gmail:${event.id}` } }), 1)

  await workflowRunsService.processWorkflowRun({ workflowRunId: other.data.workflowRunId, organizationId: foreign.id })
  const foreignDraft = await prisma.draft.findUniqueOrThrow({ where: { organizationId_idempotencyKey: {
    organizationId: foreign.id, idempotencyKey: `gmail:${other.data.webhookEventId}`,
  } }, include: { revisions: { include: { sources: true } } } })
  assert.equal(foreignDraft.revisions[0]!.sources.length, 0)
  assert.equal(foreignDraft.revisions[0]!.isRefusal, true)

  const noQuestion = await post({ ...message, messageId: '18f0a1b2c3d4e5f7', subject: 'No question' }, keys[0])
  await workflowRunsService.processWorkflowRun({ workflowRunId: noQuestion.data.workflowRunId, organizationId: org.id })
  const noQuestionDraft = await prisma.draft.findUniqueOrThrow({ where: { organizationId_idempotencyKey: {
    organizationId: org.id, idempotencyKey: `gmail:${noQuestion.data.webhookEventId}`,
  } }, include: { revisions: true } })
  assert.equal(noQuestionDraft.revisions[0]!.isRefusal, true)
  assert.equal(noQuestionDraft.reviewStatus, 'REQUIRED')

  const partial = await post({ ...message, messageId: '18f0a1b2c3d4e5f9', subject: 'Partial fixture' }, keys[0])
  failAnswer = true
  await workflowRunsService.processWorkflowRun({ workflowRunId: partial.data.workflowRunId, organizationId: org.id })
  failAnswer = false
  const partialDraft = await prisma.draft.findUniqueOrThrow({ where: { organizationId_idempotencyKey: {
    organizationId: org.id, idempotencyKey: `gmail:${partial.data.webhookEventId}`,
  } }, include: { revisions: true } })
  assert.equal(partialDraft.revisions[0]!.isRefusal, true)
  assert.match(partialDraft.revisions[0]!.content, /manual review/i)

  const failure = await post({ ...message, messageId: '18f0a1b2c3d4e5f8', subject: 'Fail fixture' }, keys[0])
  await prisma.workflowRun.update({ where: { id: failure.data.workflowRunId }, data: { maxAttempts: 1 } })
  await assert.rejects(workflowRunsService.processWorkflowRun({ workflowRunId: failure.data.workflowRunId,
    organizationId: org.id }), /Synthetic extraction outage/)
  const failed = await prisma.workflowRun.findUniqueOrThrow({ where: { id: failure.data.workflowRunId } })
  assert.equal(failed.status, 'FAILED')
  const failedDraftId = (failed.output as { draftId: string }).draftId
  assert.ok(failedDraftId)
  await workflowRunsService.operateWorkflowRun({ workflowRunId: failed.id, organizationId: org.id,
    actorUserId: owner.id, action: 'retry' })
  failExtraction = false
  await workflowRunsService.processWorkflowRun({ workflowRunId: failed.id, organizationId: org.id })
  assert.equal(await prisma.draft.count({ where: { organizationId: org.id, idempotencyKey: `gmail:${failure.data.webhookEventId}` } }), 1)
  const recovered = await prisma.workflowRun.findUniqueOrThrow({ where: { id: failed.id } })
  assert.equal((recovered.output as { draftId: string }).draftId, failedDraftId)

  const cancelled = await post({ ...message, messageId: '18f0a1b2c3d4e5fa' }, keys[0])
  const staleClaim = await claimWorkflow({ organizationId: org.id, workflowRunId: cancelled.data.workflowRunId })
  assert.ok(staleClaim)
  await workflowRunsService.operateWorkflowRun({ workflowRunId: cancelled.data.workflowRunId,
    organizationId: org.id, actorUserId: owner.id, action: 'cancel' })
  assert.equal(await createGmailReviewTask({ claim: staleClaim, eventId: cancelled.data.webhookEventId,
    message: message as Parameters<typeof createGmailReviewTask>[0]['message'], answers: [] }), null)
  assert.equal(await prisma.draft.count({ where: { organizationId: org.id,
    idempotencyKey: `gmail:${cancelled.data.webhookEventId}` } }), 0)
  assert.equal(await prisma.aiInteraction.count({ where: { organizationId: org.id } }), 0)
  console.log('PASS Gmail lease/idempotency creates one review draft, preserves failures, rejects foreign sources and performs no external send')
} finally {
  globalThis.fetch = originalFetch
  api.closeAllConnections()
  await new Promise<void>(resolve => api.close(() => resolve()))
  await prisma.$disconnect()
}
