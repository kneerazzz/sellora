/** Real HTTP/credentials/SQL; offline provider responses and actual local source retrieval. */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import type { UserRole, ApiKeyScope } from '@prisma/client'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Authorization harness requires a localhost sellora_test_* target')
}
const storage = await mkdtemp(path.join(tmpdir(), 'sellora-authz-'))
Object.assign(process.env, {
  DATABASE_URL: target, NODE_ENV: 'test', DOCUMENT_STORAGE_DIR: storage,
  DOCUMENT_UPLOAD_MAX_BYTES: '128', PROVIDER_INPUT_MAX_CHARS: '1000', PROVIDER_QUESTION_MAX: '2',
  EMBEDDING_PROVIDER: 'local', LOCAL_EMBEDDING_SERVICE_URL: 'http://127.0.0.1:1',
  AI_PROVIDER: 'openai', OPENAI_API_KEY: 'offline-fixture-only', GROQ_API_KEY: '',
})
const originalFetch = globalThis.fetch
let base = '', providerCalls = 0, requests = 0, serial = 0
const extraction = {
  summary: 'Synthetic summary', nextSteps: [], buyerQuestions: [], objections: [], riskFlags: [],
  crmUpdate: { stage: null, lastActivitySummary: null, nextFollowUpAt: null, priority: null },
  confidence: 'LOW', confidenceReason: 'Synthetic fixture',
}
// Only the exact API origin reaches a socket. All model calls are intercepted.
globalThis.fetch = async (input, init) => {
  const destination = String(input)
  if (base && destination.startsWith(`${base}/`)) return originalFetch(input, init)
  if (destination === 'https://api.openai.com/v1/responses') {
    providerCalls++
    const body = JSON.parse(String(init?.body))
    const result = body.text.format.name === 'rfp_extraction' ? { questions: ['refund policy'] } : extraction
    return Response.json({ output_text: JSON.stringify(result), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } })
  }
  if (destination === 'http://127.0.0.1:1/api/embeddings') {
    providerCalls++
    return Response.json({ embedding: Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0) })
  }
  throw new Error('Unexpected network destination in offline authorization fixture')
}
const { prisma } = await import('../../src/config/prisma')
const { sha256Hex } = await import('../../src/utils/crypto')
const { workflowRunsService } = await import('../../src/modules/workflowRuns/workflowRuns.service')
let api: Server | undefined
try {
  assert.equal(await prisma.organization.count({ where: { slug: { startsWith: 'authz-fixture-' } } }), 0)
  const { createApp } = await import('../../src/app')
  const { groundedAnswersService, createGroundedAnswersService } = await import('../../src/modules/groundedAnswers/groundedAnswers.service')
  // Preserve actual scoped SQL, citation serialization and persistence without
  // downloading a reranker. knowledgePath.ts separately tests actual vector SQL.
  groundedAnswersService.answerQuestion = createGroundedAnswersService({ hasEmbeddingsConfigured: () => false }).answerQuestion
  const orgs = await Promise.all(['a', 'b'].map(suffix => prisma.organization.create({ data: {
    name: `Authorization fixture ${suffix}`, slug: `authz-fixture-${suffix}`,
  } })))
  const org = orgs[0]!, foreign = orgs[1]!
  const password = 'FixturePassword1', hash = await bcrypt.hash(password, 4)
  const users = await Promise.all((['ADMIN', 'MANAGER', 'REP'] as UserRole[]).map(role => prisma.user.create({ data: {
    organizationId: org.id, role, email: `authz-${role}@test.invalid`, passwordHash: hash, firstName: 'Fixture', lastName: role,
  } })))
  const foreignUser = await prisma.user.create({ data: {
    organizationId: foreign.id, role: 'ADMIN', email: 'authz-foreign@test.invalid', passwordHash: hash, firstName: 'Foreign', lastName: 'Fixture',
  } })
  const sign = (user: typeof users[number]) => jwt.sign({ sub: user.id, organizationId: user.organizationId,
    email: user.email, role: user.role }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '10m' })
  const callers = users.map(user => ({ kind: user.role as string, token: sign(user), user }))
  for (const scope of ['READ_ONLY', 'FULL_ACCESS', 'WEBHOOK_ONLY'] as ApiKeyScope[]) {
    const raw = `authz-fixture-${scope}`
    await prisma.apiKey.create({ data: { organizationId: org.id, label: scope, scope, keyHash: sha256Hex(raw), keyPrefix: 'fixture' } })
    callers.push({ kind: scope, token: raw, user: users[0]! })
  }
  callers.push({ kind: 'NONE', token: '', user: users[0]! })
  const admin = callers[0]!, manager = callers[1]!, rep = callers[2]!, full = callers[4]!, hook = callers[5]!
  const seedLead = (organizationId = org.id, user = rep.user) => prisma.lead.create({ data: {
    firstName: 'Fixture', lastName: 'Lead', organizationId, createdById: user.id, assignedToId: user.id,
  } })
  const ownLead = await seedLead(), otherLead = await seedLead(foreign.id, foreignUser), peerLead = await seedLead(org.id, admin.user)
  const otherDeal = await prisma.deal.create({ data: { title: 'Foreign deal', organizationId: foreign.id,
    leadId: otherLead.id, ownerId: foreignUser.id, aiRiskFlags: [] } })
  const documentData = { filename: 'fixture.txt', displayName: 'Fixture', mimeType: 'text/plain',
    sizeBytes: 30, fileType: 'TXT' as const, storagePath: 'synthetic-not-read', tags: [] }
  const seedDoc = async (organizationId: string, uploadedById: string, text: string) => {
    const doc = await prisma.document.create({ data: {
      ...documentData, organizationId, uploadedById, status: 'COMPLETED', nextVersionNumber: 2,
    } })
    const version = await prisma.documentVersion.create({ data: {
      documentId: doc.id, organizationId, versionNumber: 1, filename: doc.filename,
      mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, fileType: doc.fileType,
      storagePath: doc.storagePath, contentHash: sha256Hex(text), status: 'ACTIVE',
    } })
    await prisma.documentChunk.create({ data: { documentId: doc.id, versionId: version.id,
      text, chunkIndex: 0, tokenCount: 10, headingPath: [] } })
    return prisma.document.update({ where: { id: doc.id }, data: { activeVersionId: version.id } })
  }
  const ownDoc = await seedDoc(org.id, admin.user.id, 'Refund policy permits refunds within thirty days.')
  const otherDoc = await seedDoc(foreign.id, foreignUser.id, 'Refund policy FOREIGN_SOURCE_MARKER.')
  const seedRun = (organizationId = org.id, completed = false) => prisma.workflowRun.create({ data: {
    organizationId, type: 'GROUNDED_TECHNICAL_ANSWER', status: completed ? 'COMPLETED' : 'QUEUED',
    input: { question: 'the and', documentIds: [] }, ...(completed && {
      output: { extraction, groundedAnswers: [] }, startedAt: new Date(), completedAt: new Date(),
    }),
  } })
  const seedFailedRun = (organizationId = org.id) => prisma.workflowRun.create({ data: {
    organizationId, type: 'GROUNDED_TECHNICAL_ANSWER', status: 'FAILED',
    input: { question: 'the and', documentIds: [] }, startedAt: new Date(), completedAt: new Date(),
    errorMessage: 'Fixture failure',
  } })
  const ownRun = await seedRun(org.id, true), otherRun = await seedRun(foreign.id, true)
  const seedDraft = async (organizationId = org.id, authorId = admin.user.id) => {
    const draft = await prisma.draft.create({ data: {
      organizationId, authorId, idempotencyKey: `authz-draft-${++serial}`,
      requestFingerprint: `authz-${serial}`, question: 'Fixture question', requestedDocumentIds: [],
    } })
    const revision = await prisma.draftRevision.create({ data: {
      organizationId, authorId, draftId: draft.id, revisionNumber: 1,
      content: 'Fixture draft.', origin: 'MANUAL',
    } })
    return prisma.draft.update({ where: { id: draft.id }, data: {
      currentRevisionId: revision.id, concurrencyToken: 1, processingStatus: 'COMPLETED',
    } })
  }
  const ownDraft = await seedDraft(), otherDraft = await seedDraft(foreign.id, foreignUser.id)
  const seedApprovedDraft = async (authorId = rep.user.id) => {
    const document = await seedDoc(org.id, admin.user.id, `Approved source ${++serial}.`)
    const chunk = await prisma.documentChunk.findFirstOrThrow({ where: { versionId: document.activeVersionId! } })
    const draft = await seedDraft(org.id, authorId)
    await prisma.draftRevisionSource.create({ data: {
      organizationId: org.id, draftRevisionId: draft.currentRevisionId!, ordinal: 0,
      documentId: document.id, versionId: document.activeVersionId!, chunkId: chunk.id,
    } })
    await prisma.draft.update({ where: { id: draft.id }, data: { reviewStatus: 'APPROVED' } })
    await prisma.draftApproval.create({ data: {
      organizationId: org.id, draftId: draft.id, revisionId: draft.currentRevisionId!,
      reviewerId: manager.user.id, decision: 'APPROVED',
    } })
    return draft
  }
  const seedApprovedAnswer = async (params: {
    organizationId?: string
    ownerId?: string
    authorId?: string
    reviewStatus?: 'APPROVED' | 'REQUIRED'
  } = {}) => {
    const organizationId = params.organizationId ?? org.id
    const ownerId = params.ownerId ?? admin.user.id
    const authorId = params.authorId ?? rep.user.id
    const reviewerId = organizationId === org.id ? manager.user.id : foreignUser.id
    const document = await seedDoc(organizationId, ownerId, `Approved answer source ${++serial}.`)
    const chunk = await prisma.documentChunk.findFirstOrThrow({ where: { versionId: document.activeVersionId! } })
    const answer = await prisma.approvedAnswer.create({ data: {
      organizationId, ownerId, title: 'Fixture approved answer', question: 'What is the fixture policy?',
      tags: ['fixture'], currentRevisionId: null, reviewStatus: params.reviewStatus ?? 'APPROVED',
    } })
    const revision = await prisma.approvedAnswerRevision.create({ data: {
      organizationId, approvedAnswerId: answer.id, authorId, revisionNumber: 1,
      title: answer.title, question: answer.question, tags: answer.tags, content: 'Fixture approved answer.',
    } })
    await prisma.approvedAnswerRevisionSource.create({ data: {
      organizationId, approvedAnswerRevisionId: revision.id, ordinal: 0,
      documentId: document.id, versionId: document.activeVersionId!, chunkId: chunk.id,
    } })
    await prisma.approvedAnswer.update({ where: { id: answer.id }, data: { currentRevisionId: revision.id } })
    if ((params.reviewStatus ?? 'APPROVED') === 'APPROVED') await prisma.approvedAnswerApproval.create({ data: {
      organizationId, approvedAnswerId: answer.id, revisionId: revision.id,
      reviewerId, decision: 'APPROVED', reviewedAt: new Date(),
    } })
    return { ...answer, currentRevisionId: revision.id }
  }
  const ownApprovedAnswer = await seedApprovedAnswer()
  const otherApprovedAnswer = await seedApprovedAnswer({ organizationId: foreign.id,
    ownerId: foreignUser.id, authorId: foreignUser.id })
  const otherIntegration = await prisma.integration.create({ data: { organizationId: foreign.id, provider: 'HUBSPOT', label: 'Foreign' } })
  const seedKey = (organizationId = org.id) => prisma.apiKey.create({ data: { organizationId, label: 'Fixture', scope: 'FULL_ACCESS',
    keyHash: sha256Hex(`fixture-key-${++serial}`), keyPrefix: 'fixture' } })
  const otherKey = await seedKey(foreign.id)
  const seedInvite = (organizationId = org.id) => prisma.invite.create({ data: { organizationId,
    email: `authz-invite-${++serial}@test.invalid`, role: 'REP', token: `authz-invite-${serial}`, expiresAt: new Date(Date.now() + 60_000) } })
  const otherInvite = await seedInvite(foreign.id)
  const seedSession = (userId: string) => prisma.refreshToken.create({ data: { userId,
    token: sha256Hex(`authz-session-${++serial}`), expiresAt: new Date(Date.now() + 60_000) } })
  const otherSession = await seedSession(foreignUser.id), peerSession = await seedSession(rep.user.id)
  api = createServer(createApp()); api.listen(0, '127.0.0.1'); await once(api, 'listening')
  const address = api.address(); assert.ok(address && typeof address === 'object')
  base = `http://127.0.0.1:${address.port}`
  async function request(method: string, route: string, token: string, body?: unknown, expected = 200) {
    requests++
    const response = await fetch(`${base}/api/v1${route}`, { method,
      headers: { ...(token && { authorization: `Bearer ${token}` }), ...(!(body instanceof FormData) && { 'content-type': 'application/json' }) },
      ...(body !== undefined && { body: body instanceof FormData ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    })
    const result = await response.json() as { data: any; message: string }
    assert.equal(response.status, expected, `${method} ${route}: ${result.message}`)
    if (expected >= 400) assert.ok(result.data == null, 'Denials expose no data')
    assert.ok(!JSON.stringify(result).includes('FOREIGN_SOURCE_MARKER'))
    return result.data
  }
  const staff = ['ADMIN', 'MANAGER', 'REP'], managers = ['ADMIN', 'MANAGER'], mixed = [...staff, 'FULL_ACCESS', 'WEBHOOK_ONLY']
  type Case = { method: string; route: string; allow: string[]; api?: boolean; status?: number;
    body?: unknown; setup?: (caller: typeof admin) => Promise<{ route?: string; body?: unknown }> }
  const cases: Case[] = [
    { method: 'GET', route: '/users', allow: staff },
    { method: 'GET', route: '/users/me', allow: staff },
    { method: 'PATCH', route: '/users/profile', allow: staff, body: { title: 'Fixture' } },
    { method: 'PATCH', route: '/users/change-password', allow: staff, body: { currentPassword: password, newPassword: 'ChangedFixture2' } },
    { method: 'GET', route: '/auth/sessions', allow: staff },
    { method: 'DELETE', route: '/auth/sessions/:id', allow: staff, setup: async c => ({ route: `/auth/sessions/${(await seedSession(c.user.id)).id}` }) },
    { method: 'POST', route: '/auth/logout-all', allow: staff, body: {} },
    { method: 'GET', route: '/leads', allow: staff },
    { method: 'POST', route: '/leads', allow: staff, status: 201, body: { firstName: 'New', lastName: 'Lead' } },
    { method: 'GET', route: `/leads/${ownLead.id}`, allow: staff },
    { method: 'GET', route: `/leads/${ownLead.id}/detail`, allow: staff },
    { method: 'PATCH', route: `/leads/${ownLead.id}`, allow: staff, body: { notes: 'Updated' } },
    { method: 'DELETE', route: '/leads/:id', allow: managers, setup: async () => ({ route: `/leads/${(await seedLead()).id}` }) },
    { method: 'PATCH', route: '/leads/bulk/assign', allow: managers, body: { leadIds: [ownLead.id], assignedToId: rep.user.id } },
    { method: 'PATCH', route: '/leads/bulk/status', allow: managers, body: { leadIds: [ownLead.id], status: 'CONTACTED' } },
    { method: 'GET', route: '/documents', allow: staff },
    { method: 'GET', route: `/documents/${ownDoc.id}`, allow: staff },
    { method: 'POST', route: '/documents', allow: managers, status: 201, body: documentData },
    { method: 'POST', route: '/documents/upload', allow: managers, status: 201, body: { filename: 'upload.txt', content: 'Refund policy permits refunds within thirty days.' } },
    { method: 'POST', route: '/documents/upload-file', allow: managers, status: 201, setup: async () => {
      const form = new FormData(); form.set('file', new Blob(['Refund policy permits refunds.'], { type: 'text/plain' }), 'upload.txt'); return { body: form }
    } },
    { method: 'POST', route: `/documents/${ownDoc.id}/ingest-text`, allow: managers, body: { text: 'Refund policy permits refunds within thirty days.' } },
    { method: 'GET', route: `/documents/${ownDoc.id}/versions`, allow: staff },
    { method: 'POST', route: '/documents/resolve-references', allow: staff,
      setup: async () => { const doc = await prisma.document.findUniqueOrThrow({ where: { id: ownDoc.id } })
        const chunk = await prisma.documentChunk.findFirstOrThrow({ where: { versionId: doc.activeVersionId! } })
        return { body: { references: [{ documentId: doc.id, versionId: doc.activeVersionId, chunkId: chunk.id }] } } } },
    { method: 'GET', route: '/documents/:id/versions/:versionId/source', allow: staff,
      setup: async () => { const doc = await prisma.document.findUniqueOrThrow({ where: { id: ownDoc.id } })
        return { route: `/documents/${doc.id}/versions/${doc.activeVersionId}/source` } } },
    { method: 'GET', route: `/documents/${ownDoc.id}/erasure-preview`, allow: ['ADMIN'] },
    { method: 'POST', route: `/documents/${ownDoc.id}/replace-text`, allow: managers,
      setup: async () => ({ body: { text: 'Refund policy permits refunds within thirty days.',
        expectedActiveVersionId: (await prisma.document.findUniqueOrThrow({ where: { id: ownDoc.id } })).activeVersionId } }) },
    { method: 'POST', route: `/documents/${ownDoc.id}/replace-file`, allow: managers,
      setup: async () => { const form = new FormData(); form.set('file', new Blob(['Refund policy permits refunds.'],
        { type: 'text/plain' }), 'replacement.txt'); form.set('expectedActiveVersionId',
        (await prisma.document.findUniqueOrThrow({ where: { id: ownDoc.id } })).activeVersionId!); return { body: form } } },
    { method: 'POST', route: '/documents/:id/versions/:versionId/retry', allow: managers,
      setup: async () => {
        const doc = await seedDoc(org.id, admin.user.id, 'Refund policy permits refunds.')
        const stored = path.join(storage, `retry-${++serial}.txt`)
        const content = 'Refund policy permits refunds.'
        await writeFile(stored, content)
        const version = await prisma.documentVersion.create({ data: {
          documentId: doc.id, organizationId: org.id, versionNumber: 2,
          basedOnVersionId: doc.activeVersionId, contentHash: sha256Hex(content),
          filename: 'retry.txt', mimeType: 'text/plain', sizeBytes: content.length,
          fileType: 'TXT', storagePath: stored, status: 'FAILED', errorMessage: 'Fixture failure',
        } })
        return { route: `/documents/${doc.id}/versions/${version.id}/retry`, body: {} }
      } },
    { method: 'DELETE', route: '/documents/:id', allow: managers,
      setup: async () => { const doc = await seedDoc(org.id, admin.user.id, 'Refund policy permits refunds.')
        return { route: `/documents/${doc.id}`, body: { expectedActiveVersionId: doc.activeVersionId } } } },
    { method: 'GET', route: '/api-keys', allow: managers },
    { method: 'GET', route: '/usage/summary', allow: managers },
    { method: 'PUT', route: '/usage/pause', allow: ['ADMIN'], body: { paused: false } },
    { method: 'GET', route: '/drafts', allow: staff },
    { method: 'POST', route: '/drafts', allow: staff, status: 201,
      setup: async () => ({ body: { idempotencyKey: `authz-create-draft-${++serial}`,
        question: 'Fixture question', draftText: 'Fixture draft.' } }) },
    { method: 'GET', route: `/drafts/${ownDraft.id}`, allow: staff },
    { method: 'POST', route: '/drafts/:id/revisions', allow: staff,
      setup: async c => { const draft = await seedDraft(org.id, c.user.id); return {
        route: `/drafts/${draft.id}/revisions`, body: { expectedRevisionId: draft.currentRevisionId,
          content: 'Authorized correction.' },
      } } },
    { method: 'DELETE', route: '/drafts/:id', allow: staff,
      setup: async c => { const draft = await seedDraft(org.id, c.user.id); return {
        route: `/drafts/${draft.id}`, body: { expectedConcurrencyToken: draft.concurrencyToken },
      } } },
    { method: 'POST', route: '/drafts/:id/approvals', allow: ['ADMIN', 'MANAGER'],
      setup: async c => { const author = users.find(user => user.id !== c.user.id)!; const draft = await seedDraft(org.id, author.id)
        return { route: `/drafts/${draft.id}/approvals`, body: { revisionId: draft.currentRevisionId } } } },
    { method: 'POST', route: '/drafts/:id/exports', allow: staff,
      setup: async c => { const draft = await seedDraft(org.id, c.user.id)
        return { route: `/drafts/${draft.id}/exports`, body: { revisionId: draft.currentRevisionId } } } },
    { method: 'POST', route: '/drafts/:id/exports/:exportId/copied', allow: staff, status: 201,
      setup: async c => { const draft = await seedDraft(org.id, c.user.id)
        const request = await prisma.draftExportRequest.create({ data: { organizationId: org.id, draftId: draft.id,
          revisionId: draft.currentRevisionId!, requesterId: c.user.id } })
        return { route: `/drafts/${draft.id}/exports/${request.id}/copied`, body: {} } } },
    { method: 'GET', route: '/approved-answers', allow: staff },
    { method: 'GET', route: '/approved-answers/suggestions?question=fixture%20policy', allow: staff },
    { method: 'GET', route: '/approved-answers/review-queue', allow: staff },
    { method: 'POST', route: '/approved-answers', allow: staff, status: 201,
      setup: async c => { const draft = await seedApprovedDraft(c.user.id); return { body: {
        draftId: draft.id, revisionId: draft.currentRevisionId, title: `Authorized answer ${++serial}`,
      } } } },
    { method: 'GET', route: `/approved-answers/${ownApprovedAnswer.id}`, allow: staff },
    { method: 'POST', route: '/approved-answers/:id/revisions', allow: staff,
      setup: async c => { const answer = await seedApprovedAnswer({ ownerId: c.user.id, authorId: c.user.id }); return {
        route: `/approved-answers/${answer.id}/revisions`, body: {
          expectedRevisionId: answer.currentRevisionId, content: 'Authorized approved answer correction.',
        },
      } } },
    { method: 'POST', route: '/approved-answers/:id/approvals', allow: managers,
      setup: async c => { const author = users.find(user => user.id !== c.user.id)!;
        const answer = await seedApprovedAnswer({ authorId: author.id, reviewStatus: 'REQUIRED' }); return {
          route: `/approved-answers/${answer.id}/approvals`, body: { revisionId: answer.currentRevisionId },
        } } },
    { method: 'POST', route: '/approved-answers/:id/reuse', allow: staff, status: 201,
      setup: async c => { const answer = await seedApprovedAnswer(); return {
        route: `/approved-answers/${answer.id}/reuse`, body: {
          expectedRevisionId: answer.currentRevisionId, idempotencyKey: `authz-reuse-${++serial}`,
          question: 'What is the fixture policy?',
        },
      } } },
    { method: 'DELETE', route: '/approved-answers/:id', allow: staff,
      setup: async c => { const answer = await seedApprovedAnswer({ ownerId: c.user.id }); return {
        route: `/approved-answers/${answer.id}`, body: { expectedConcurrencyToken: answer.concurrencyToken },
      } } },
    { method: 'POST', route: '/api-keys', allow: managers, status: 201, body: { label: 'Fixture', scope: 'READ_ONLY' } },
    { method: 'DELETE', route: '/api-keys/:id', allow: managers, setup: async () => ({ route: `/api-keys/${(await seedKey()).id}` }) },
    { method: 'GET', route: '/invites', allow: managers },
    { method: 'POST', route: '/invites', allow: managers, status: 201, setup: async () => ({ body: { email: `new-${++serial}@test.invalid`, role: 'REP' } }) },
    { method: 'DELETE', route: '/invites/:id', allow: managers, setup: async () => ({ route: `/invites/${(await seedInvite()).id}` }) },
    { method: 'POST', route: '/invites/:id/resend', allow: managers, setup: async () => ({ route: `/invites/${(await seedInvite()).id}/resend` }) },
    { method: 'POST', route: '/ai/grounded-answers', allow: [...staff, 'FULL_ACCESS'], api: true, body: { question: 'refund policy', documentIds: [ownDoc.id] } },
    { method: 'POST', route: '/ai/extractions/sales-event', allow: [...staff, 'FULL_ACCESS'], api: true, body: { sourceType: 'MANUAL', content: 'Synthetic sales conversation for authorization.' } },
    { method: 'POST', route: '/ai/extractions/rfp', allow: [...staff, 'FULL_ACCESS'], api: true, body: { content: 'Synthetic questionnaire for authorization.', documentIds: [ownDoc.id] } },
    { method: 'GET', route: '/workflow-runs', allow: mixed, api: true },
    { method: 'GET', route: `/workflow-runs/${ownRun.id}`, allow: mixed, api: true },
    { method: 'POST', route: '/workflow-runs/:id/process', allow: mixed, api: true, setup: async () => ({ route: `/workflow-runs/${(await seedRun()).id}/process` }) },
    { method: 'POST', route: '/workflow-runs/process-next', allow: staff, body: {} },
    { method: 'POST', route: '/workflow-runs/process-queued', allow: staff, body: { limit: 1 } },
    { method: 'POST', route: '/workflow-runs/:id/retry', allow: staff, body: {},
      setup: async () => ({ route: `/workflow-runs/${(await seedFailedRun()).id}/retry` }) },
    { method: 'POST', route: '/workflow-runs/:id/cancel', allow: staff, body: {},
      setup: async () => ({ route: `/workflow-runs/${(await seedRun()).id}/cancel` }) },
    { method: 'POST', route: '/crm-writeback/preview', allow: mixed, api: true, status: 201, body: { workflowRunId: ownRun.id, provider: 'HUBSPOT' } },
    ...['email-received', 'call-transcript', 'manual-question'].map(name => ({ method: 'POST', route: `/webhooks/${name}`,
      allow: ['FULL_ACCESS', 'WEBHOOK_ONLY'], api: true, status: 202, body: { payload: { question: 'the and', documentIds: [] } } })),
    { method: 'POST', route: '/webhooks/gmail-received', allow: ['FULL_ACCESS', 'WEBHOOK_ONLY'], api: true, status: 202,
      body: { version: 1, messageId: '18f0a1b2c3d4e5f6', threadId: '18f0a1b2c3d4e5f6', from: 'buyer@example.test',
        to: 'pilot@example.test', subject: 'Question', text: 'Can you explain the refund window?',
        messageDate: new Date().toISOString(), sizeEstimate: 1024 } },
  ]
  for (const entry of cases) for (const caller of callers) {
    const allowed = entry.allow.includes(caller.kind), setup = await entry.setup?.(caller)
    const expected = allowed ? entry.status ?? 200 : caller.kind === 'NONE' || (!entry.api && !staff.includes(caller.kind)) ||
      (entry.route.startsWith('/webhooks/') && staff.includes(caller.kind)) ? 401 : 403
    const callsBefore = providerCalls
    const data = await request(entry.method, setup?.route ?? entry.route, caller.token, setup?.body ?? entry.body, expected)
    if (!allowed) assert.equal(providerCalls, callsBefore, 'Denied request cannot invoke providers')
    if (allowed && entry.method === 'GET' && Array.isArray(data)) assert.ok(data.every(row => !row.organizationId || row.organizationId === org.id))
    if (allowed && entry.route === '/ai/grounded-answers') {
      assert.equal(data.refused, false); assert.ok(data.citations.length > 0)
      assert.ok(data.citations.every((c: { documentId: string }) => c.documentId === ownDoc.id))
    }
  }
  console.log(`PASS ${cases.length} protected routes across 7 caller kinds; denied calls do no provider work`)
  for (const caller of callers.filter(c => staff.includes(c.kind))) {
    for (const route of [`/documents/${otherDoc.id}`, `/leads/${otherLead.id}`, `/leads/${otherLead.id}/detail`, `/workflow-runs/${otherRun.id}`]) await request('GET', route, caller.token, undefined, 404)
    await request('PATCH', `/leads/${otherLead.id}`, caller.token, { notes: 'Forbidden' }, 404)
    await request('DELETE', `/auth/sessions/${otherSession.id}`, caller.token, undefined, 404)
    if (caller.kind !== 'REP') {
      await request('POST', `/documents/${otherDoc.id}/ingest-text`, caller.token, { text: 'Forbidden' }, 404)
      for (const route of [`/leads/${otherLead.id}`, `/api-keys/${otherKey.id}`, `/invites/${otherInvite.id}`]) await request('DELETE', route, caller.token, undefined, 404)
      await request('POST', `/invites/${otherInvite.id}/resend`, caller.token, {}, 404)
      await request('PATCH', '/leads/bulk/assign', caller.token, { leadIds: [ownLead.id], assignedToId: foreignUser.id }, 400)
      assert.equal((await request('PATCH', '/leads/bulk/status', caller.token, { leadIds: [otherLead.id], status: 'CONTACTED' })).updatedCount, 0)
    }
  }
  await request('DELETE', `/auth/sessions/${peerSession.id}`, admin.token, undefined, 404)
  for (const suffix of ['', '/detail']) await request('GET', `/leads/${peerLead.id}${suffix}`, rep.token, undefined, 404)
  await request('PATCH', `/leads/${peerLead.id}`, rep.token, { notes: 'Forbidden' }, 404)
  await request('PATCH', `/leads/${ownLead.id}`, rep.token, { assignedToId: admin.user.id }, 403)
  await request('POST', '/leads', rep.token, { firstName: 'No', lastName: 'Reassignment', assignedToId: admin.user.id }, 403)
  const repLeads = await request('GET', `/leads?assignedToId=${admin.user.id}`, rep.token)
  assert.ok(repLeads.every((lead: { assignedTo: { id: string } }) => lead.assignedTo.id === rep.user.id))
  for (const caller of [admin, full, hook]) {
    await request('GET', `/workflow-runs/${otherRun.id}`, caller.token, undefined, 404)
    await request('POST', `/workflow-runs/${otherRun.id}/process`, caller.token, {}, 404)
    await request('POST', '/crm-writeback/preview', caller.token, { workflowRunId: otherRun.id, provider: 'HUBSPOT' }, 404)
    await request('POST', '/crm-writeback/preview', caller.token, { workflowRunId: ownRun.id, provider: 'HUBSPOT', integrationId: otherIntegration.id }, 404)
  }
  for (const caller of callers.filter(c => staff.includes(c.kind))) {
    await request('POST', `/workflow-runs/${otherRun.id}/retry`, caller.token, {}, 404)
    await request('POST', `/workflow-runs/${otherRun.id}/cancel`, caller.token, {}, 404)
    await request('GET', `/drafts/${otherDraft.id}`, caller.token, undefined, 404)
    await request('POST', `/drafts/${otherDraft.id}/revisions`, caller.token,
      { expectedRevisionId: otherDraft.currentRevisionId, content: 'Forbidden edit' }, 404)
    await request('DELETE', `/drafts/${otherDraft.id}`, caller.token,
      { expectedConcurrencyToken: otherDraft.concurrencyToken }, 404)
    await request('POST', `/drafts/${otherDraft.id}/approvals`, caller.token,
      { revisionId: otherDraft.currentRevisionId }, caller.kind === 'ADMIN' || caller.kind === 'MANAGER' ? 404 : 403)
    await request('POST', `/drafts/${otherDraft.id}/exports`, caller.token,
      { revisionId: otherDraft.currentRevisionId }, 404)
    await request('GET', `/approved-answers/${otherApprovedAnswer.id}`, caller.token, undefined, 404)
    await request('POST', `/approved-answers/${otherApprovedAnswer.id}/revisions`, caller.token,
      { expectedRevisionId: otherApprovedAnswer.currentRevisionId, content: 'Forbidden edit' }, 404)
    await request('DELETE', `/approved-answers/${otherApprovedAnswer.id}`, caller.token,
      { expectedConcurrencyToken: otherApprovedAnswer.concurrencyToken }, 404)
    await request('POST', `/approved-answers/${otherApprovedAnswer.id}/approvals`, caller.token,
      { revisionId: otherApprovedAnswer.currentRevisionId },
      caller.kind === 'ADMIN' || caller.kind === 'MANAGER' ? 404 : 403)
    await request('POST', `/approved-answers/${otherApprovedAnswer.id}/reuse`, caller.token, {
      expectedRevisionId: otherApprovedAnswer.currentRevisionId,
      idempotencyKey: `foreign-reuse-${caller.kind.toLowerCase()}`,
      question: 'What is the fixture policy?',
    }, 404)
  }
  for (const caller of [admin, full]) {
    const before = providerCalls
    for (const link of [{ leadId: otherLead.id }, { dealId: otherDeal.id }]) await request('POST', '/ai/extractions/sales-event', caller.token, { sourceType: 'MANUAL', content: 'Synthetic sales conversation for authorization.', ...link }, 404)
    assert.equal(providerCalls, before)
    for (const ids of [[otherDoc.id], [], [ownDoc.id, otherDoc.id]]) {
      const result = await request('POST', '/ai/grounded-answers', caller.token, { question: 'refund policy', documentIds: ids })
      assert.equal(result.refused, !ids.includes(ownDoc.id))
      assert.ok(result.citations.every((c: { documentId: string }) => c.documentId === ownDoc.id))
    }
    const rfp = await request('POST', '/ai/extractions/rfp', caller.token, { content: 'Synthetic questionnaire for authorization.', documentIds: [otherDoc.id] })
    assert.equal(rfp.results[0].refused, true); assert.deepEqual(rfp.results[0].citations, [])
  }
  for (const caller of [admin, full]) {
    const before = providerCalls
    await request('POST', '/ai/extractions/sales-event', caller.token, {
      sourceType: 'MANUAL', content: 'x'.repeat(1001),
    }, 422)
    await request('POST', '/documents/upload', caller.token, {
      filename: 'oversized.txt', content: 'x'.repeat(129),
    }, caller === admin ? 400 : 401)
    assert.equal(providerCalls, before, 'Input limits must reject before provider work')
  }
  const allowanceBlocker = await prisma.workloadReservation.create({ data: {
    organizationId: org.id, reservationKey: 'authorization-allowance-blocker', operation: 'fixture-blocker',
    reservedUnits: 1_000_000, expiresAt: new Date(Date.now() + 120_000),
  } })
  for (const caller of [admin, full]) {
    const before = providerCalls
    await request('POST', '/ai/extractions/sales-event', caller.token, {
      sourceType: 'MANUAL', content: 'Synthetic sales conversation blocked by shared admission.',
    }, 429)
    assert.equal(providerCalls, before, 'Admission denial must happen before provider dispatch')
  }
  const workerWebhook = await prisma.webhookEvent.create({ data: {
    organizationId: org.id, source: 'N8N', eventType: 'EMAIL_RECEIVED', payload: {
      subject: 'Synthetic integration fixture', body: 'Internal worker request blocked by shared admission.',
    },
  } })
  const workerRun = await prisma.workflowRun.create({ data: {
    organizationId: org.id, webhookEventId: workerWebhook.id, type: 'SALES_EVENT_EXTRACTION', input: {
      subject: 'Synthetic integration fixture', body: 'Internal worker request blocked by shared admission.',
    },
  } })
  const callsBeforeWorker = providerCalls
  await assert.rejects(
    workflowRunsService.processWorkflowRun({ workflowRunId: workerRun.id, organizationId: org.id, userId: admin.user.id }),
    (error: any) => error.statusCode === 429
  )
  assert.equal(providerCalls, callsBeforeWorker, 'Internal worker denial must happen before provider dispatch')
  assert.equal((await prisma.workflowRun.findUniqueOrThrow({ where: { id: workerRun.id } })).status, 'FAILED')
  assert.equal((await prisma.webhookEvent.findUniqueOrThrow({ where: { id: workerWebhook.id } })).status, 'FAILED')
  await prisma.workloadReservation.update({ where: { id: allowanceBlocker.id }, data: {
    status: 'RELEASED', actualUnits: 0, measurementStatus: 'MEASURED', completedAt: new Date(),
  } })
  const unknownTrace = await prisma.usageTrace.create({ data: {
    organizationId: org.id, operation: 'summary-unknown-fixture', status: 'FAILED',
  } })
  await prisma.usageAttempt.create({ data: {
    traceId: unknownTrace.id, component: 'generation', attemptNumber: 1,
    category: 'PROVIDER', provider: 'fixture', model: 'fixture-v1', status: 'FAILED',
    startedAt: new Date(), measurementStatus: 'UNKNOWN',
  } })
  const summary = await request('GET', '/usage/summary', admin.token)
  assert.ok(summary.unknownAttempts > 0)
  assert.ok(summary.alerts.some((alert: { kind: string }) => alert.kind === 'ALLOWANCE_EXHAUSTED'))
  const foreignSummary = await request('GET', '/usage/summary', sign(foreignUser))
  assert.equal(foreignSummary.unknownAttempts, 0)
  assert.ok(foreignSummary.failedTraces.every((trace: { id: string }) => !summary.failedTraces.some((own: { id: string }) => own.id === trace.id)))
  await request('PUT', '/usage/pause', rep.token, { paused: true }, 403)
  await request('PUT', '/usage/pause', full.token, { paused: true }, 401)
  await request('PUT', '/usage/pause', admin.token, { paused: true })
  const pausedBefore = providerCalls
  await request('POST', '/ai/extractions/sales-event', admin.token, {
    sourceType: 'MANUAL', content: 'Synthetic sales conversation blocked by pause.',
  }, 403)
  await request('POST', '/ai/extractions/sales-event', full.token, {
    sourceType: 'MANUAL', content: 'Synthetic sales conversation blocked by pause.',
  }, 403)
  assert.equal(providerCalls, pausedBefore)
  assert.equal((await request('GET', '/usage/summary', admin.token)).paused, true)
  await request('PUT', '/usage/pause', admin.token, { paused: false })
  assert.equal((await request('GET', '/usage/summary', admin.token)).paused, false)
  console.log('PASS scoped usage view, alert, authorized pause/resume and pre-dispatch denial')
  console.log('PASS bounded inputs and shared JWT/API/worker admission before provider work')
  for (const caller of [full, hook]) {
    const beforeUnsupported = await prisma.workflowRun.count({ where: { organizationId: org.id, type: 'CRM_UPDATE_PREPARATION' } })
    await request('POST', '/webhooks/crm-event', caller.token, { payload: {} }, 400)
    assert.equal(await prisma.workflowRun.count({ where: { organizationId: org.id, type: 'CRM_UPDATE_PREPARATION' } }), beforeUnsupported)
    await request('POST', '/webhooks/manual-question', caller.token, { integrationId: otherIntegration.id, payload: {} }, 404)
    const intake = await request('POST', '/webhooks/manual-question', caller.token, { payload: {
      organizationId: foreign.id, question: 'refund policy', documentIds: [otherDoc.id],
    } }, 202)
    assert.equal(intake.webhookEvent.organizationId, org.id)
    const processed = await request('POST', `/workflow-runs/${intake.workflowRunId}/process`, caller.token, {})
    assert.equal(processed.organizationId, org.id); assert.equal(processed.output.refused, true); assert.deepEqual(processed.output.citations, [])
  }
  assert.equal((await prisma.lead.findUniqueOrThrow({ where: { id: otherLead.id } })).status, 'NEW')
  assert.equal((await prisma.apiKey.findUniqueOrThrow({ where: { id: otherKey.id } })).isActive, true)
  assert.equal((await prisma.invite.findUniqueOrThrow({ where: { id: otherInvite.id } })).status, 'PENDING')
  console.log('PASS tenant/REP/user-owned detail, mutation, joins, source and nested webhook boundaries')
  for (const [method, route, body, token] of [
    ['POST', '/documents', documentData, admin.token], ['POST', '/leads', { firstName: 'No', lastName: 'Override' }, rep.token],
    ['PATCH', '/leads/bulk/status', { leadIds: [ownLead.id], status: 'NEW' }, admin.token],
    ['POST', '/ai/grounded-answers', { question: 'refund policy' }, full.token],
    ['POST', '/drafts', { idempotencyKey: 'authz-override-draft', question: 'No override', draftText: 'No.' }, rep.token],
    ['POST', '/webhooks/manual-question', { payload: {} }, hook.token], ['PATCH', '/users/profile', { firstName: 'No' }, admin.token],
  ] as const) await request(method, route, token, { ...body, organizationId: foreign.id }, 403)
  const form = new FormData(); form.set('organizationId', foreign.id); form.set('file', new Blob(['Forbidden override'], { type: 'text/plain' }), 'override.txt')
  await request('POST', '/documents/upload-file', admin.token, form, 403)
  const list = await request('GET', `/documents?organizationId=${foreign.id}`, admin.token)
  assert.ok(list.every((row: { organizationId: string }) => row.organizationId === org.id))
  for (const state of ['revoked', 'expired']) {
    const raw = `authz-${state}`
    await prisma.apiKey.create({ data: { organizationId: org.id, label: state, scope: 'FULL_ACCESS', keyHash: sha256Hex(raw), keyPrefix: 'fixture',
      ...(state === 'revoked' ? { isActive: false } : { expiresAt: new Date(0) }) } })
    await request('POST', '/ai/grounded-answers', raw, { question: 'refund policy' }, 401)
    await request('POST', '/webhooks/manual-question', raw, { payload: {} }, 401)
  }
  for (const caller of callers) await request('GET', `/drafts/${ownDraft.id}/export`, caller.token, undefined,
    staff.includes(caller.kind) ? 404 : 401)
  // Document router authenticates before its unmatched-path 404.
  for (const caller of callers) await request('GET', `/documents/${ownDoc.id}/source`, caller.token, undefined, staff.includes(caller.kind) ? 404 : 401)
  const publicInvite = await seedInvite()
  const inviteInfo = await request('GET', `/invites/validate/${publicInvite.token}`, '')
  assert.equal(inviteInfo.email, publicInvite.email)
  assert.equal(inviteInfo.organizationName, org.name)
  assert.equal(inviteInfo.token, undefined)
  await request('GET', '/invites/validate/unknown-fixture-token', '', undefined, 404)
  const accepted = await request('POST', '/auth/accept-invite', '', {
    token: publicInvite.token, firstName: 'Invited', lastName: 'Fixture', password,
    role: 'ADMIN', // Unknown fields cannot promote the role bound to the invite.
  }, 201)
  assert.equal(accepted.user.role, 'REP')
  assert.equal(accepted.user.organizationId, org.id)
  const login = await request('POST', '/auth/login', '', { email: publicInvite.email, password })
  assert.equal(login.user.id, accepted.user.id)
  await request('POST', '/auth/login', '', { email: publicInvite.email, password: 'WrongPassword1' }, 401)
  await request('POST', '/auth/refresh', '', { refreshToken: 'unknown-fixture-token' }, 401)
  await request('POST', '/auth/logout', '', { refreshToken: 'unknown-fixture-token' })
  const registered = await request('POST', '/auth/register', '', {
    firstName: 'Registered', lastName: 'Fixture', email: 'authz-register@test.invalid', password,
    organizationName: 'Registration fixture', organizationSlug: 'authz-fixture-registered', role: 'REP',
  }, 201)
  assert.equal(registered.user.role, 'ADMIN')
  assert.notEqual(registered.user.organizationId, org.id)
  assert.notEqual(registered.user.organizationId, foreign.id)
  assert.ok(await prisma.usageTrace.count({ where: { organizationId: org.id, requestId: { not: null } } }) > 0)
  assert.ok(await prisma.usageTrace.count({ where: { organizationId: org.id, workflowRunId: { not: null } } }) > 0)
  assert.ok(await prisma.usageAttempt.count({ where: { trace: { organizationId: org.id }, category: 'PROVIDER' } }) > 0)
  console.log(`PASS overrides, key expiry/revocation, public capabilities and remaining absent future routes; ${requests} HTTP assertions total`)
} finally {
  if (api) { api.closeAllConnections(); await new Promise<void>(resolve => api!.close(() => resolve())) }
  globalThis.fetch = originalFetch
  await prisma.$disconnect()
  await rm(storage, { recursive: true, force: true })
}
