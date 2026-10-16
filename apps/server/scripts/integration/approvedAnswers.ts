/** Real HTTP/SQL approved-answer acceptance on an explicitly disposable database. */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const targetUrl = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(targetUrl.hostname) ||
  !targetUrl.pathname.startsWith('/sellora_test_')) {
  throw new Error('Approved-answer harness requires a localhost sellora_test_* target')
}
Object.assign(process.env, { DATABASE_URL: target, NODE_ENV: 'test' })

const { prisma } = await import('../../src/config/prisma')
const { sha256Hex } = await import('../../src/utils/crypto')
const { isEffectiveApprovedAnswer } = await import('../../src/modules/approvedAnswers/approvedAnswers.service')
const { persistIngestedChunks } = await import('../../src/modules/documents/ingestionPersistence')
const { documentsService } = await import('../../src/modules/documents/documents.service')
let api: Server | undefined

try {
  const passwordHash = await bcrypt.hash('ApprovedAnswerFixture1', 4)
  const [organization, foreignOrganization] = await Promise.all([
    prisma.organization.create({ data: { name: 'Approved answer fixture', slug: 'approved-answer-fixture' } }),
    prisma.organization.create({ data: { name: 'Foreign approved answer fixture', slug: 'approved-answer-foreign' } }),
  ])
  const [admin, manager, rep, foreignAdmin] = await Promise.all([
    prisma.user.create({ data: { organizationId: organization.id, email: 'approved-admin@test.invalid',
      passwordHash, firstName: 'Approved', lastName: 'Admin', role: 'ADMIN' } }),
    prisma.user.create({ data: { organizationId: organization.id, email: 'approved-manager@test.invalid',
      passwordHash, firstName: 'Approved', lastName: 'Manager', role: 'MANAGER' } }),
    prisma.user.create({ data: { organizationId: organization.id, email: 'approved-rep@test.invalid',
      passwordHash, firstName: 'Approved', lastName: 'Rep', role: 'REP' } }),
    prisma.user.create({ data: { organizationId: foreignOrganization.id, email: 'approved-foreign@test.invalid',
      passwordHash, firstName: 'Approved', lastName: 'Foreign', role: 'ADMIN' } }),
  ])
  const sign = (user: typeof admin) => jwt.sign({ sub: user.id, organizationId: user.organizationId,
    email: user.email, role: user.role }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '10m' })
  const tokens = { admin: sign(admin), manager: sign(manager), rep: sign(rep), foreign: sign(foreignAdmin) }

  async function seedSource(ownerOrganizationId: string, uploadedById: string, marker: string) {
    const document = await prisma.document.create({ data: {
      filename: `${marker}.txt`, displayName: `${marker} policy`, mimeType: 'text/plain',
      sizeBytes: marker.length, fileType: 'TXT', storagePath: `/disposable/${marker}.txt`, tags: [],
      status: 'COMPLETED', nextVersionNumber: 2, organizationId: ownerOrganizationId, uploadedById,
    } })
    const version = await prisma.documentVersion.create({ data: {
      documentId: document.id, organizationId: ownerOrganizationId, versionNumber: 1,
      filename: document.filename, mimeType: document.mimeType, sizeBytes: document.sizeBytes,
      fileType: document.fileType, storagePath: document.storagePath, contentHash: sha256Hex(marker),
      status: 'ACTIVE', publishedAt: new Date(),
    } })
    const chunk = await prisma.documentChunk.create({ data: {
      documentId: document.id, versionId: version.id, chunkIndex: 0,
      text: `${marker} refunds are allowed within thirty days.`, tokenCount: 8, headingPath: [],
    } })
    await prisma.document.update({ where: { id: document.id }, data: { activeVersionId: version.id } })
    return { document, version, chunk }
  }

  async function seedDraft(params: {
    organizationId: string
    authorId: string
    reviewerId: string
    source: Awaited<ReturnType<typeof seedSource>>
    marker: string
    approved?: boolean
  }) {
    const draft = await prisma.draft.create({ data: {
      organizationId: params.organizationId,
      authorId: params.authorId,
      idempotencyKey: `library-${params.marker}`,
      requestFingerprint: sha256Hex(params.marker),
      question: `What is the ${params.marker} refund policy?`,
      requestedDocumentIds: [params.source.document.id],
    } })
    const revision = await prisma.draftRevision.create({ data: {
      organizationId: params.organizationId,
      draftId: draft.id,
      authorId: params.authorId,
      revisionNumber: 1,
      content: `${params.marker} refunds are allowed within thirty days.`,
      origin: 'MANUAL',
    } })
    await prisma.draftRevisionSource.create({ data: {
      organizationId: params.organizationId,
      draftRevisionId: revision.id,
      ordinal: 0,
      documentId: params.source.document.id,
      versionId: params.source.version.id,
      chunkId: params.source.chunk.id,
    } })
    await prisma.draft.update({ where: { id: draft.id }, data: {
      currentRevisionId: revision.id,
      concurrencyToken: 1,
      processingStatus: 'COMPLETED',
      reviewStatus: params.approved === false ? 'REQUIRED' : 'APPROVED',
    } })
    const approval = params.approved === false ? null : await prisma.draftApproval.create({ data: {
      organizationId: params.organizationId,
      draftId: draft.id,
      revisionId: revision.id,
      reviewerId: params.reviewerId,
      decision: 'APPROVED',
      note: 'Fixture source reviewed.',
    } })
    return { draft, revision, approval }
  }

  const source = await seedSource(organization.id, admin.id, 'library')
  const foreignSource = await seedSource(foreignOrganization.id, foreignAdmin.id, 'foreign-library')
  const approvedDraft = await seedDraft({ organizationId: organization.id, authorId: rep.id,
    reviewerId: manager.id, source, marker: 'approved' })
  const unapprovedDraft = await seedDraft({ organizationId: organization.id, authorId: rep.id,
    reviewerId: manager.id, source, marker: 'unapproved', approved: false })
  const foreignDraft = await seedDraft({ organizationId: foreignOrganization.id, authorId: foreignAdmin.id,
    reviewerId: foreignAdmin.id, source: foreignSource, marker: 'foreign' })

  const { createApp } = await import('../../src/app')
  api = createServer(createApp())
  api.listen(0, '127.0.0.1')
  await once(api, 'listening')
  const address = api.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}/api/v1`

  async function request(method: string, route: string, token: string, body?: unknown, expected = 200) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    const envelope = await response.json() as { data?: any; meta?: any; message: string }
    assert.equal(response.status, expected, `${method} ${route}: ${envelope.message}`)
    if (expected >= 400) assert.equal(envelope.data, undefined)
    return envelope
  }

  await request('POST', '/approved-answers', tokens.rep, {
    draftId: unapprovedDraft.draft.id,
    revisionId: unapprovedDraft.revision.id,
    title: 'Unapproved answer',
  }, 409)
  await request('POST', '/approved-answers', tokens.rep, {
    draftId: foreignDraft.draft.id,
    revisionId: foreignDraft.revision.id,
    title: 'Foreign answer',
  }, 404)

  const saved = (await request('POST', '/approved-answers', tokens.rep, {
    draftId: approvedDraft.draft.id,
    revisionId: approvedDraft.revision.id,
    title: 'Approved refund answer',
    tags: ['Refunds', 'Policy', 'refunds'],
  }, 201)).data
  assert.equal(saved.reviewStatus, 'APPROVED')
  assert.equal(saved.eligibility, 'CURRENT')
  assert.deepEqual(saved.tags, ['Refunds', 'Policy'])
  assert.equal(saved.revisions[0].sourceDraftRevisionId, approvedDraft.revision.id)
  assert.equal(saved.approvals[0].sourceDraftApprovalId, approvedDraft.approval!.id)
  assert.equal(saved.approvals[0].reviewer.id, manager.id)
  assert.equal(saved.revisions[0].sources[0].availability, 'CURRENT')
  assert.equal(await isEffectiveApprovedAnswer(prisma, saved.id, saved.currentRevisionId, organization.id), true)

  const duplicate = (await request('POST', '/approved-answers', tokens.admin, {
    draftId: approvedDraft.draft.id,
    revisionId: approvedDraft.revision.id,
    title: 'Approved refund answer',
    tags: ['Refunds', 'Policy'],
  }, 201)).data
  assert.equal(duplicate.id, saved.id)
  assert.equal(await prisma.approvedAnswer.count({ where: { organizationId: organization.id } }), 1)
  await request('POST', '/approved-answers', tokens.rep, {
    draftId: approvedDraft.draft.id,
    revisionId: approvedDraft.revision.id,
    title: 'Conflicting duplicate title',
    tags: ['Refunds', 'Policy'],
  }, 409)
  const concurrentDraft = await seedDraft({ organizationId: organization.id, authorId: rep.id,
    reviewerId: manager.id, source, marker: 'concurrent-save' })
  const saveBodies = ['Concurrent title A', 'Concurrent title B'].map(title => ({
    draftId: concurrentDraft.draft.id,
    revisionId: concurrentDraft.revision.id,
    title,
    question: 'How are concurrent records handled?',
    tags: ['Concurrent'],
  }))
  const concurrentSaves = await Promise.all(saveBodies.map(body => fetch(`${base}/approved-answers`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokens.rep}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })))
  assert.deepEqual(concurrentSaves.map(response => response.status).sort(), [201, 409])
  await Promise.all(concurrentSaves.map(response => response.json()))
  assert.equal(await prisma.approvedAnswerRevision.count({
    where: { organizationId: organization.id, sourceDraftRevisionId: concurrentDraft.revision.id },
  }), 1)
  console.log('PASS approved/foreign eligibility, source lineage and sequential/concurrent idempotent save')

  const list = await request('GET',
    '/approved-answers?search=Approved%20refund%20answer&page=1&limit=1', tokens.admin)
  assert.equal(list.data.length, 1)
  assert.equal(list.data[0].id, saved.id)
  assert.equal(list.meta.total, 1)
  assert.equal((await request('GET', `/approved-answers/${saved.id}`, tokens.manager)).data.id, saved.id)
  await request('GET', `/approved-answers/${saved.id}`, tokens.foreign, undefined, 404)
  assert.equal((await request('GET', '/approved-answers', tokens.foreign)).data.length, 0)
  console.log('PASS organization-scoped paginated search and detail')

  const edited = (await request('POST', `/approved-answers/${saved.id}/revisions`, tokens.rep, {
    expectedRevisionId: saved.currentRevisionId,
    content: 'Reviewed refunds are allowed within thirty calendar days.',
    tags: ['Refunds', 'Reviewed'],
  })).data
  assert.equal(edited.reviewStatus, 'REQUIRED')
  assert.equal(edited.eligibility, 'REVIEW_REQUIRED')
  assert.equal(edited.revisions.length, 2)
  assert.equal(edited.approvals.length, 1)
  assert.equal(await isEffectiveApprovedAnswer(prisma, saved.id, edited.currentRevisionId, organization.id), false)
  await request('POST', `/approved-answers/${saved.id}/revisions`, tokens.admin, {
    expectedRevisionId: saved.currentRevisionId,
    content: 'Stale edit attempt.',
  }, 409)
  await request('POST', `/approved-answers/${saved.id}/approvals`, tokens.rep, {
    revisionId: edited.currentRevisionId,
  }, 403)
  const reapproved = (await request('POST', `/approved-answers/${saved.id}/approvals`, tokens.manager, {
    revisionId: edited.currentRevisionId,
    note: 'Reviewed corrected wording.',
  })).data
  assert.equal(reapproved.reviewStatus, 'APPROVED')
  assert.equal(reapproved.eligibility, 'CURRENT')
  assert.equal(reapproved.approvals.length, 2)
  assert.equal(reapproved.invalidations[0].reason, 'ANSWER_EDITED')
  assert.equal(await isEffectiveApprovedAnswer(prisma, saved.id, reapproved.currentRevisionId, organization.id), true)
  await assert.rejects(prisma.approvedAnswerRevision.update({
    where: { id: reapproved.currentRevisionId }, data: { content: 'Forbidden mutation' },
  }))
  await assert.rejects(prisma.approvedAnswerApproval.update({
    where: { id: reapproved.approvals[0].id }, data: { note: 'Forbidden mutation' },
  }))
  console.log('PASS edits create immutable review-required revisions and reapproval retains audit history')

  const suggestions = (await request('GET',
    '/approved-answers/suggestions?question=What%20is%20the%20refund%20policy%3F&limit=5', tokens.rep)).data
  assert.equal(suggestions.length, 1)
  assert.equal(suggestions[0].id, saved.id)
  assert.match(suggestions[0].suggestionReason, /^Shared terms:/)
  assert.equal(suggestions[0].currentRevision.sourceCount, 1)
  assert.equal((await request('GET',
    '/approved-answers/suggestions?question=aircraft%20maintenance', tokens.rep)).data.length, 0)
  assert.equal((await request('GET',
    '/approved-answers/suggestions?question=refund%20policy', tokens.foreign)).data.length, 0)
  await request('POST', `/approved-answers/${saved.id}/reuse`, tokens.rep, {
    expectedRevisionId: saved.currentRevisionId,
    idempotencyKey: 'library-reuse-irrelevant',
    question: 'How often is aircraft maintenance required?',
  }, 409)
  await request('POST', `/approved-answers/${saved.id}/reuse`, tokens.rep, {
    expectedRevisionId: saved.currentRevisionId,
    idempotencyKey: 'library-reuse-old-revision',
    question: 'What is the refund policy?',
  }, 409)
  const reused = (await request('POST', `/approved-answers/${saved.id}/reuse`, tokens.rep, {
    expectedRevisionId: reapproved.currentRevisionId,
    idempotencyKey: 'library-reuse-current-0001',
    question: 'What refund policy applies to enterprise buyers?',
    title: 'Enterprise buyer refund question',
  }, 201)).data
  assert.equal(reused.processingStatus, 'COMPLETED')
  assert.equal(reused.reviewStatus, 'REQUIRED')
  assert.equal(reused.deliveryStatus, 'NOT_REQUESTED')
  assert.equal(reused.reusedApprovedAnswerId, saved.id)
  assert.equal(reused.reusedApprovedAnswerRevisionId, reapproved.currentRevisionId)
  assert.equal(reused.approvals.length, 0)
  assert.equal(reused.revisions[0].content, reapproved.revisions[0].content)
  assert.equal(reused.revisions[0].sources[0].availability, 'CURRENT')
  const reusedAgain = (await request('POST', `/approved-answers/${saved.id}/reuse`, tokens.admin, {
    expectedRevisionId: reapproved.currentRevisionId,
    idempotencyKey: 'library-reuse-current-0001',
    question: 'What refund policy applies to enterprise buyers?',
    title: 'Enterprise buyer refund question',
  }, 201)).data
  assert.equal(reusedAgain.id, reused.id)
  assert.equal(await prisma.draft.count({ where: { organizationId: organization.id,
    idempotencyKey: 'library-reuse-current-0001' } }), 1)
  await request('POST', `/approved-answers/${saved.id}/reuse`, tokens.rep, {
    expectedRevisionId: reapproved.currentRevisionId,
    idempotencyKey: 'library-reuse-current-0001',
    question: 'Which refund policy applies?',
  }, 409)
  console.log('PASS relevant suggestions create one idempotent unapproved draft with exact reuse lineage')

  let concurrentReuse: Promise<unknown> | undefined
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "documents" WHERE "id" = ${source.document.id} FOR UPDATE`
    concurrentReuse = request('POST', `/approved-answers/${saved.id}/reuse`, tokens.rep, {
      expectedRevisionId: reapproved.currentRevisionId,
      idempotencyKey: 'library-reuse-source-race',
      question: 'What is the refund policy during a source update?',
    }, 409)
    await new Promise(resolve => setTimeout(resolve, 50))
    await tx.documentVersion.update({ where: { id: source.version.id }, data: { status: 'RETIRED' } })
    await tx.document.update({ where: { id: source.document.id }, data: { activeVersionId: null } })
  })
  assert.ok(concurrentReuse)
  await concurrentReuse
  assert.equal((await request('GET',
    '/approved-answers/suggestions?question=refund%20policy', tokens.rep)).data.length, 0)
  console.log('PASS concurrent source retirement is rechecked and stale answers disappear from suggestions')

  const staleReadQueue = await request('GET', '/approved-answers/review-queue?page=1&limit=10', tokens.admin)
  const staleReadItem = staleReadQueue.data.find((item: { id: string }) => item.id === saved.id)
  assert.ok(staleReadItem)
  assert.ok(staleReadItem.reasons.some((reason: { code: string }) => reason.code === 'SOURCE_UPDATED'))
  console.log('PASS review queue read-time checks expose stale sources even without a prior invalidation event')

  const replacementSource = await seedSource(organization.id, admin.id, 'replacement-library')
  const replacementDraft = await seedDraft({ organizationId: organization.id, authorId: rep.id,
    reviewerId: manager.id, source: replacementSource, marker: 'replacement-entry' })
  const replacementEntry = (await request('POST', '/approved-answers', tokens.rep, {
    draftId: replacementDraft.draft.id,
    revisionId: replacementDraft.revision.id,
    title: 'Replacement tracked refund policy',
    tags: ['refund', 'replacement'],
  }, 201)).data
  const unrelatedSource = await seedSource(organization.id, admin.id, 'unrelated-library')
  const unrelatedDraft = await seedDraft({ organizationId: organization.id, authorId: rep.id,
    reviewerId: manager.id, source: unrelatedSource, marker: 'unrelated-entry' })
  const unrelatedEntry = (await request('POST', '/approved-answers', tokens.rep, {
    draftId: unrelatedDraft.draft.id,
    revisionId: unrelatedDraft.revision.id,
    title: 'Unrelated refund policy',
    tags: ['refund', 'unrelated'],
  }, 201)).data

  const nextVersion = await prisma.documentVersion.create({ data: {
    documentId: replacementSource.document.id,
    organizationId: organization.id,
    versionNumber: 2,
    basedOnVersionId: replacementSource.version.id,
    contentHash: sha256Hex('replacement-current-v2'),
    filename: replacementSource.document.filename,
    mimeType: replacementSource.document.mimeType,
    sizeBytes: 24,
    fileType: replacementSource.document.fileType,
    storagePath: '/disposable/replacement-current-v2.txt',
    status: 'BUILDING',
  } })
  await prisma.$transaction(tx => persistIngestedChunks(tx, {
    documentId: replacementSource.document.id,
    versionId: nextVersion.id,
    expectedActiveVersionId: replacementSource.version.id,
    chunks: [{ text: 'Updated refunds are allowed within forty-five days.', chunkIndex: 0,
      tokenCount: 9, overlapTokens: 0, headingPath: [], sectionTitle: null }],
    embeddings: null,
  }, async () => {}))
  const nextChunk = await prisma.documentChunk.findFirstOrThrow({ where: { versionId: nextVersion.id } })
  const invalidated = await prisma.approvedAnswer.findUniqueOrThrow({ where: { id: replacementEntry.id },
    include: { invalidations: { orderBy: { createdAt: 'desc' } } } })
  assert.equal(invalidated.reviewStatus, 'REQUIRED')
  assert.equal(invalidated.invalidations[0].reason, 'SOURCE_REPLACED')
  assert.equal(invalidated.invalidations[0].previousVersionId, replacementSource.version.id)
  assert.equal(invalidated.invalidations[0].currentVersionId, nextVersion.id)
  assert.equal((await prisma.approvedAnswer.findUniqueOrThrow({ where: { id: unrelatedEntry.id } })).reviewStatus,
    'APPROVED')
  const replacementQueue = await request('GET', '/approved-answers/review-queue?page=1&limit=1', tokens.admin)
  assert.ok(replacementQueue.meta.total >= 2)
  assert.equal(replacementQueue.data.length, 1)
  const refreshedQueue = await request('GET', '/approved-answers/review-queue?page=1&limit=100', tokens.admin)
  const replacementQueueItem = refreshedQueue.data.find((item: { id: string }) => item.id === replacementEntry.id)
  assert.ok(replacementQueueItem.reasons.some((reason: { code: string; currentVersionId: string }) =>
    reason.code === 'SOURCE_UPDATED' && reason.currentVersionId === nextVersion.id))
  console.log('PASS source replacement eagerly queues only affected current revisions with version reasons')

  const refreshed = (await request('POST', `/approved-answers/${replacementEntry.id}/revisions`, tokens.rep, {
    expectedRevisionId: replacementEntry.currentRevisionId,
    content: 'Updated refunds are allowed within forty-five days.',
    sources: [{ documentId: replacementSource.document.id, versionId: nextVersion.id, chunkId: nextChunk.id }],
  })).data
  assert.equal(refreshed.eligibility, 'REVIEW_REQUIRED')
  const restored = (await request('POST', `/approved-answers/${replacementEntry.id}/approvals`, tokens.manager, {
    revisionId: refreshed.currentRevisionId,
    note: 'Reviewed against replacement source.',
  })).data
  assert.equal(restored.eligibility, 'CURRENT')
  assert.equal(restored.approvals.length, 2)
  assert.equal(restored.invalidations.length, 2)
  assert.equal(await isEffectiveApprovedAnswer(prisma, replacementEntry.id, restored.currentRevisionId,
    organization.id), true)
  const afterRestoreQueue = (await request('GET', '/approved-answers/review-queue?page=1&limit=100', tokens.admin)).data
  assert.ok(afterRestoreQueue.every((item: { id: string }) => item.id !== replacementEntry.id))
  console.log('PASS current-source edit and exact reapproval restore eligibility while retaining audit history')

  const deletionSource = await seedSource(organization.id, admin.id, 'deletion-library')
  const deletionDraft = await seedDraft({ organizationId: organization.id, authorId: rep.id,
    reviewerId: manager.id, source: deletionSource, marker: 'deletion-entry' })
  const deletionEntry = (await request('POST', '/approved-answers', tokens.rep, {
    draftId: deletionDraft.draft.id,
    revisionId: deletionDraft.revision.id,
    title: 'Deletion tracked refund policy',
    tags: ['refund', 'deletion'],
  }, 201)).data
  await documentsService.deleteDocument(deletionSource.document.id, organization.id, deletionSource.version.id)
  const deletionQueue = (await request('GET', '/approved-answers/review-queue?page=1&limit=100', tokens.admin)).data
  const deletionQueueItem = deletionQueue.find((item: { id: string }) => item.id === deletionEntry.id)
  assert.ok(deletionQueueItem.reasons.some((reason: { code: string }) => reason.code === 'SOURCE_DELETED'))
  assert.equal(deletionQueueItem.invalidations[0].reason, 'SOURCE_DELETED')
  assert.equal((await prisma.approvedAnswer.findUniqueOrThrow({ where: { id: unrelatedEntry.id } })).reviewStatus,
    'APPROVED')
  await request('POST', `/approved-answers/${deletionEntry.id}/reuse`, tokens.rep, {
    expectedRevisionId: deletionEntry.currentRevisionId,
    idempotencyKey: 'library-reuse-deleted-source',
    question: 'What is the refund policy?',
  }, 409)
  await assert.rejects(prisma.approvedAnswerInvalidation.update({
    where: { id: deletionQueueItem.invalidations[0].id }, data: { reason: 'SOURCE_REPLACED' },
  }))
  console.log('PASS deletion immediately queues and blocks only affected entries; invalidation audit is immutable')

  const archived = (await request('DELETE', `/approved-answers/${saved.id}`, tokens.rep, {
    expectedConcurrencyToken: reapproved.concurrencyToken,
  })).data
  assert.ok(archived.archivedAt)
  await request('DELETE', `/approved-answers/${saved.id}`, tokens.rep, {
    expectedConcurrencyToken: reapproved.concurrencyToken,
  }, 409)
  await request('POST', `/approved-answers/${saved.id}/revisions`, tokens.rep, {
    expectedRevisionId: archived.currentRevisionId,
    content: 'Cannot edit archive.',
  }, 409)
  assert.ok((await request('GET', '/approved-answers?archived=active', tokens.admin)).data
    .every((answer: { id: string }) => answer.id !== saved.id))
  assert.ok((await request('GET', '/approved-answers?archived=archived', tokens.admin)).data
    .some((answer: { id: string }) => answer.id === saved.id))
  await request('POST', `/approved-answers/${saved.id}/reuse`, tokens.rep, {
    expectedRevisionId: archived.currentRevisionId,
    idempotencyKey: 'library-reuse-archived',
    question: 'What is the refund policy?',
  }, 409)
  console.log('PASS archive concurrency and active search exclusion')
} finally {
  if (api) {
    api.closeAllConnections()
    await new Promise<void>(resolve => api!.close(() => resolve()))
  }
  await prisma.$disconnect()
}
