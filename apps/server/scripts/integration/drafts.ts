/** Real HTTP/SQL draft acceptance on an explicitly disposable database. */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const targetUrl = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(targetUrl.hostname) || !targetUrl.pathname.startsWith('/sellora_test_')) {
  throw new Error('Draft harness requires a localhost sellora_test_* target')
}
Object.assign(process.env, { DATABASE_URL: target, NODE_ENV: 'test' })

const { prisma } = await import('../../src/config/prisma')
const { sha256Hex } = await import('../../src/utils/crypto')
const { groundedAnswersService } = await import('../../src/modules/groundedAnswers/groundedAnswers.service')
const { isEffectiveDraftApproval } = await import('../../src/modules/drafts/drafts.service')
let api: Server | undefined

try {
  assert.equal(await prisma.organization.count({ where: { slug: { startsWith: 'draft-fixture-' } } }), 0)
  const passwordHash = await bcrypt.hash('DraftFixturePassword1', 4)
  const [organization, foreignOrganization] = await Promise.all([
    prisma.organization.create({ data: { name: 'Draft fixture', slug: 'draft-fixture-own' } }),
    prisma.organization.create({ data: { name: 'Draft fixture foreign', slug: 'draft-fixture-foreign' } }),
  ])
  const [admin, manager, rep, foreignAdmin] = await Promise.all([
    prisma.user.create({ data: { organizationId: organization.id, email: 'draft-admin@test.invalid',
      passwordHash, firstName: 'Draft', lastName: 'Admin', role: 'ADMIN' } }),
    prisma.user.create({ data: { organizationId: organization.id, email: 'draft-manager@test.invalid',
      passwordHash, firstName: 'Draft', lastName: 'Manager', role: 'MANAGER' } }),
    prisma.user.create({ data: { organizationId: organization.id, email: 'draft-rep@test.invalid',
      passwordHash, firstName: 'Draft', lastName: 'Rep', role: 'REP' } }),
    prisma.user.create({ data: { organizationId: foreignOrganization.id, email: 'draft-foreign@test.invalid',
      passwordHash, firstName: 'Draft', lastName: 'Foreign', role: 'ADMIN' } }),
  ])
  const sign = (user: typeof admin) => jwt.sign({ sub: user.id, organizationId: user.organizationId,
    email: user.email, role: user.role }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '10m' })
  const tokens = { admin: sign(admin), manager: sign(manager), rep: sign(rep), foreign: sign(foreignAdmin) }

  async function seedDocument(ownerOrganizationId: string, uploadedById: string, marker: string) {
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
  const source = await seedDocument(organization.id, admin.id, 'own')
  const foreignSource = await seedDocument(foreignOrganization.id, foreignAdmin.id, 'foreign')

  let generationCalls = 0
  const originalAnswerQuestion = groundedAnswersService.answerQuestion
  groundedAnswersService.answerQuestion = (async (input: { question: string }) => {
    generationCalls++
    if (input.question.includes('slow')) await new Promise(resolve => setTimeout(resolve, 100))
    if (input.question.includes('failure')) throw new Error('synthetic provider detail must not escape')
    if (input.question.includes('refusal')) return {
      answer: 'I do not have enough grounded document context to answer this question.',
      refused: true, confidence: 'LOW', reviewRequired: true, citations: [], aiInteractionId: 'fixture-refusal',
    }
    return {
      answer: 'Refunds are allowed within thirty days.', refused: false, confidence: 'LOW',
      reviewRequired: true, aiInteractionId: 'fixture-success',
      citations: [{ documentId: source.document.id, documentName: source.document.displayName,
        filename: source.document.filename, versionId: source.version.id, chunkId: source.chunk.id,
        chunkIndex: source.chunk.chunkIndex, pageNumber: null, headingPath: [], sectionTitle: null,
        score: 1, snippet: source.chunk.text }],
    }
  }) as typeof groundedAnswersService.answerQuestion

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
    const envelope = await response.json() as { data?: any; meta?: any; message: string; errors?: string[] }
    assert.equal(response.status, expected, `${method} ${route}: ${envelope.message}`)
    if (expected >= 400) {
      assert.equal(envelope.data, undefined)
      assert.ok(!JSON.stringify(envelope).includes('synthetic provider detail'))
    }
    return envelope
  }

  async function requestWithStatus(method: string, route: string, token: string, body: unknown) {
    const response = await fetch(`${base}${route}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    return { status: response.status, envelope: await response.json() as { data?: any; message: string } }
  }

  const createdEnvelope = await request('POST', '/drafts', tokens.rep, {
    idempotencyKey: 'draft-success-0001', question: 'success question', documentIds: [source.document.id],
  }, 201)
  const created = createdEnvelope.data
  assert.equal(created.processingStatus, 'COMPLETED')
  assert.equal(created.reviewStatus, 'REQUIRED')
  assert.equal(created.deliveryStatus, 'NOT_REQUESTED')
  assert.equal(created.revisions.length, 1)
  assert.equal(created.revisions[0].sources[0].availability, 'CURRENT')
  assert.equal(created.revisions[0].sources[0].documentId, source.document.id)
  assert.equal(created.revisions[0].sources[0].displayName, source.document.displayName)

  const approvedRevisionId = created.currentRevisionId as string
  await request('POST', `/drafts/${created.id}/approvals`, tokens.rep, { revisionId: approvedRevisionId }, 403)
  const approved = (await request('POST', `/drafts/${created.id}/approvals`, tokens.manager,
    { revisionId: approvedRevisionId, note: 'Reviewed against current source.' })).data
  assert.equal(approved.reviewStatus, 'APPROVED')
  assert.equal(approved.approvals[0].decision, 'APPROVED')
  assert.equal(await isEffectiveDraftApproval(prisma, created.id, approvedRevisionId, organization.id), true)
  await request('POST', `/drafts/${created.id}/approvals`, tokens.manager, { revisionId: approvedRevisionId }, 409)
  await request('POST', `/drafts/${created.id}/approvals`, tokens.foreign, { revisionId: approvedRevisionId }, 404)
  console.log('PASS exact-revision approval, self-review/foreign denial and effective approval predicate')

  const requestedExport = (await request('POST', `/drafts/${created.id}/exports`, tokens.manager, {
    revisionId: approvedRevisionId, includeSources: true, approvedOnly: true,
  })).data
  assert.equal(requestedExport.revisionId, approvedRevisionId)
  assert.equal(requestedExport.content, created.revisions[0].content)
  assert.equal(requestedExport.approvalStatus, 'APPROVED')
  assert.equal(requestedExport.sourceStatus, 'CURRENT')
  assert.match(requestedExport.text, /Sources:/)
  await request('POST', `/drafts/${created.id}/exports/${requestedExport.exportId}/copied`, tokens.rep, {}, 404)
  await request('POST', `/drafts/${created.id}/exports/${requestedExport.exportId}/copied`, tokens.manager, {}, 201)
  await request('POST', `/drafts/${created.id}/exports/${requestedExport.exportId}/copied`, tokens.manager, {}, 409)
  assert.equal((await prisma.draft.findUniqueOrThrow({ where: { id: created.id } })).deliveryStatus, 'NOT_REQUESTED')
  console.log('PASS exact revision export and separate single-use browser copy confirmation without delivery state')

  const replay = (await request('POST', '/drafts', tokens.manager, {
    idempotencyKey: 'draft-success-0001', question: 'success question', documentIds: [source.document.id],
  }, 201)).data
  assert.equal(replay.id, created.id)
  assert.equal(await prisma.draft.count({ where: { organizationId: organization.id, idempotencyKey: 'draft-success-0001' } }), 1)
  await request('POST', '/drafts', tokens.rep, {
    idempotencyKey: 'draft-success-0001', question: 'different input',
  }, 409)

  const callsBeforeRace = generationCalls
  const raced = await Promise.all([
    request('POST', '/drafts', tokens.rep, { idempotencyKey: 'draft-race-000001', question: 'slow success question' }, 201),
    request('POST', '/drafts', tokens.rep, { idempotencyKey: 'draft-race-000001', question: 'slow success question' }, 201),
  ])
  assert.equal(raced[0].data.id, raced[1].data.id)
  assert.equal(generationCalls - callsBeforeRace, 1)
  assert.equal(await prisma.draft.count({ where: { organizationId: organization.id, idempotencyKey: 'draft-race-000001' } }), 1)
  console.log('PASS idempotent create/retry, payload conflict and concurrent single generation')

  const beforeEdit = (await request('GET', `/drafts/${created.id}`, tokens.manager)).data
  const expectedRevisionId = beforeEdit.currentRevisionId as string
  const edits = await Promise.all([
    requestWithStatus('POST', `/drafts/${created.id}/revisions`, tokens.manager,
      { expectedRevisionId, content: 'Manager correction.' }),
    requestWithStatus('POST', `/drafts/${created.id}/revisions`, tokens.rep,
      { expectedRevisionId, content: 'Rep correction.' }),
  ])
  assert.deepEqual(edits.map(edit => edit.status).sort(), [200, 409])
  assert.ok(edits.find(edit => edit.status === 200)?.envelope.data)
  assert.equal(edits.find(edit => edit.status === 409)?.envelope.data, undefined)
  const afterEdit = (await request('GET', `/drafts/${created.id}`, tokens.admin)).data
  assert.equal(afterEdit.revisions.length, 2)
  assert.equal(afterEdit.concurrencyToken, 2)
  assert.equal(afterEdit.reviewStatus, 'REQUIRED')
  assert.equal(afterEdit.approvals.length, 1, 'historical approval remains attributed')
  assert.equal(await isEffectiveDraftApproval(prisma, created.id, expectedRevisionId, organization.id), false)
  const oldRevisionExport = (await request('POST', `/drafts/${created.id}/exports`, tokens.admin, {
    revisionId: expectedRevisionId, includeSources: false, approvedOnly: false,
  })).data
  assert.equal(oldRevisionExport.revisionId, expectedRevisionId)
  assert.equal(oldRevisionExport.content, beforeEdit.revisions[0].content)
  assert.equal(oldRevisionExport.approvalStatus, 'UNAPPROVED')
  await request('POST', `/drafts/${created.id}/exports`, tokens.admin, {
    revisionId: expectedRevisionId, approvedOnly: true,
  }, 409)

  const raceDraft = (await request('POST', '/drafts', tokens.rep, {
    idempotencyKey: 'draft-approval-edit-race', question: 'race question', draftText: 'Initial revision for race.',
  }, 201)).data
  const approvalEditRace = await Promise.all([
    requestWithStatus('POST', `/drafts/${raceDraft.id}/approvals`, tokens.manager,
      { revisionId: raceDraft.currentRevisionId }),
    requestWithStatus('POST', `/drafts/${raceDraft.id}/revisions`, tokens.rep,
      { expectedRevisionId: raceDraft.currentRevisionId, content: 'Concurrent edited revision.' }),
  ])
  assert.ok(approvalEditRace.every(result => [200, 409].includes(result.status)))
  assert.ok(approvalEditRace.some(result => result.status === 200), 'one serialized action should win')
  const raceFinal = (await request('GET', `/drafts/${raceDraft.id}`, tokens.admin)).data
  if (raceFinal.reviewStatus === 'APPROVED') {
    assert.equal(raceFinal.approvals[0].revisionId, raceFinal.currentRevisionId)
    assert.equal(raceFinal.revisions[0].id, raceFinal.currentRevisionId)
  } else {
    assert.equal(raceFinal.reviewStatus, 'REQUIRED')
  }
  console.log('PASS concurrent edit/approve cannot make an unseen or superseded revision effective')
  assert.ok(['Manager correction.', 'Rep correction.'].includes(afterEdit.revisions[0].content))
  await assert.rejects(prisma.draftRevision.update({
    where: { id: afterEdit.currentRevisionId }, data: { content: 'Forbidden mutation' },
  }))
  const immutableSource = await prisma.draftRevisionSource.findFirstOrThrow({
    where: { draftRevisionId: afterEdit.currentRevisionId },
  })
  await assert.rejects(prisma.draftRevisionSource.update({
    where: { id: immutableSource.id }, data: { ordinal: 9 },
  }))
  assert.notEqual((await prisma.draftRevision.findUniqueOrThrow({ where: { id: afterEdit.currentRevisionId } })).content, 'Forbidden mutation')
  console.log('PASS one-winner optimistic edit and database-enforced revision/source immutability')

  const refused = (await request('POST', '/drafts', tokens.rep, {
    idempotencyKey: 'draft-refusal-001', question: 'refusal question',
  }, 201)).data
  assert.equal(refused.processingStatus, 'REFUSED')
  assert.equal(refused.revisions[0].isRefusal, true)
  const failed = (await request('POST', '/drafts', tokens.rep, {
    idempotencyKey: 'draft-failure-001', question: 'failure question',
  }, 201)).data
  assert.equal(failed.processingStatus, 'FAILED')
  assert.equal(failed.currentRevisionId, null)
  assert.equal(failed.generationErrorCode, 'GENERATION_FAILED')
  assert.equal(failed.revisions.length, 0)
  console.log('PASS refusal and generation failure remain visible as durable draft outcomes')

  const pageOne = await request('GET', '/drafts?page=1&limit=2', tokens.admin)
  assert.equal(pageOne.data.length, 2)
  assert.ok(pageOne.meta.total >= 4)
  assert.equal(pageOne.meta.hasNextPage, true)
  await request('GET', `/drafts/${created.id}`, tokens.foreign, undefined, 404)
  await request('POST', `/drafts/${created.id}/revisions`, tokens.foreign, {
    expectedRevisionId: afterEdit.currentRevisionId, content: 'Foreign edit',
  }, 404)
  assert.equal((await request('GET', '/drafts', tokens.foreign)).data.length, 0)
  await assert.rejects(prisma.draft.create({ data: {
    organizationId: organization.id, authorId: foreignAdmin.id, idempotencyKey: 'cross-org-author',
    requestFingerprint: 'fixture', question: 'Forbidden', requestedDocumentIds: [],
  } }))
  await assert.rejects(prisma.draftRevisionSource.create({ data: {
    organizationId: organization.id, draftRevisionId: afterEdit.currentRevisionId, ordinal: 99,
    documentId: foreignSource.document.id, versionId: foreignSource.version.id, chunkId: foreignSource.chunk.id,
  } }))
  console.log('PASS scoped list/detail/edit and database rejection of cross-organization associations')

  const sourceRaceDraft = (await request('POST', '/drafts', tokens.rep, {
    idempotencyKey: 'draft-source-invalidation-race', question: 'source race question',
    documentIds: [source.document.id],
  }, 201)).data
  let sourceRaceApproval: Promise<{ status: number; envelope: { data?: any; message: string } }> | undefined
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "documents" WHERE "id" = ${source.document.id} FOR UPDATE`
    sourceRaceApproval = requestWithStatus('POST', `/drafts/${sourceRaceDraft.id}/approvals`, tokens.manager,
      { revisionId: sourceRaceDraft.currentRevisionId })
    await new Promise(resolve => setTimeout(resolve, 50))
    await tx.documentVersion.update({ where: { id: source.version.id }, data: { status: 'RETIRED' } })
    await tx.document.update({ where: { id: source.document.id }, data: { activeVersionId: null } })
  })
  assert.ok(sourceRaceApproval)
  assert.equal((await sourceRaceApproval).status, 409)
  console.log('PASS source invalidation serializes ahead of approval and stale references are denied')
  const stale = (await request('GET', `/drafts/${created.id}`, tokens.admin)).data
  assert.ok(stale.revisions.flatMap((revision: any) => revision.sources).every((item: any) => item.availability === 'STALE'))
  await prisma.document.update({ where: { id: source.document.id }, data: { status: 'DELETED', deletedAt: new Date() } })
  const staleExport = (await request('POST', `/drafts/${created.id}/exports`, tokens.admin, {
    revisionId: afterEdit.currentRevisionId, includeSources: true,
  })).data
  assert.equal(staleExport.sourceStatus, 'UNAVAILABLE')
  assert.doesNotMatch(staleExport.text, /own policy/)
  await request('POST', `/drafts/${created.id}/approvals`, tokens.admin, {
    revisionId: afterEdit.currentRevisionId,
  }, 409)
  const unavailable = (await request('GET', `/drafts/${created.id}`, tokens.admin)).data
  assert.ok(unavailable.revisions.flatMap((revision: any) => revision.sources).every((item: any) => item.availability === 'UNAVAILABLE'))
  assert.ok(unavailable.revisions.flatMap((revision: any) => revision.sources).every((item: any) => item.displayName === undefined))
  console.log('PASS draft reads recompute current/stale/unavailable source state without passage snapshots')

  const archived = (await request('DELETE', `/drafts/${created.id}`, tokens.manager, {
    expectedConcurrencyToken: unavailable.concurrencyToken,
  })).data
  assert.ok(archived.archivedAt)
  await request('POST', `/drafts/${created.id}/exports`, tokens.manager, {
    revisionId: archived.currentRevisionId,
  }, 409)
  await request('DELETE', `/drafts/${created.id}`, tokens.manager, {
    expectedConcurrencyToken: unavailable.concurrencyToken,
  }, 409)
  await request('POST', `/drafts/${created.id}/revisions`, tokens.rep, {
    expectedRevisionId: archived.currentRevisionId, content: 'Cannot edit archive',
  }, 409)
  const activeList = await request('GET', '/drafts?archived=active', tokens.admin)
  assert.ok(activeList.data.every((draft: { id: string }) => draft.id !== created.id))
  const archivedList = await request('GET', '/drafts?archived=archived', tokens.admin)
  assert.ok(archivedList.data.some((draft: { id: string }) => draft.id === created.id))
  console.log('PASS archive concurrency and active/archived pagination behavior')

  for (const token of [tokens.admin, tokens.manager, tokens.rep]) {
    const manual = await request('POST', '/drafts', token, {
      idempotencyKey: `manual-${token.slice(-12)}`, question: 'Manual question', draftText: 'Manual draft.',
    }, 201)
    assert.equal(manual.data.processingStatus, 'COMPLETED')
  }
  const rawMachineKey = 'draft-machine-full-access'
  await prisma.apiKey.create({ data: { organizationId: organization.id, label: 'Draft machine', scope: 'FULL_ACCESS',
    keyHash: sha256Hex(rawMachineKey), keyPrefix: 'draft' } })
  await request('GET', '/drafts', rawMachineKey, undefined, 401)
  console.log('PASS all staff roles may use draft CRUD; machine credentials are denied')

  groundedAnswersService.answerQuestion = originalAnswerQuestion
} finally {
  if (api) {
    api.closeAllConnections()
    await new Promise<void>(resolve => api!.close(() => resolve()))
  }
  await prisma.$disconnect()
}
