/** Run only against a fresh, explicitly disposable localhost database. No providers called. */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import pg from 'pg'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Set SELLORA_DISPOSABLE_DATABASE_URL explicitly; DATABASE_URL is never reused')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Disposable target must be localhost with database name sellora_test_*')
}
Object.assign(process.env, {
  DATABASE_URL: target, NODE_ENV: 'test', REDIS_URL: 'redis://127.0.0.1:1',
  JWT_ACCESS_SECRET: 'disposable-test-access-secret-000000',
  JWT_REFRESH_SECRET: 'disposable-test-refresh-secret-00000',
  EMBEDDING_PROVIDER: 'local',
})
const client = new pg.Client({ connectionString: target })
await client.connect()
const { prisma } = await import('../../src/config/prisma')
try {
  const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
  assert.equal(tables.rowCount, 0, 'Refusing to test against a nonempty database')
  const migrations = (await readdir('prisma/migrations')).filter((name) => /^\d/.test(name)).sort()
  const forward = '20261001000000_restore_nomic_embedding_contract'
  assert.ok(migrations.includes(forward))
  for (const migration of migrations.filter((name) => name < forward)) {
    await client.query(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'))
  }
  await client.query(`INSERT INTO organizations (id,"updatedAt",name,slug) VALUES ('org-a',NOW(),'A','test-a'),('org-b',NOW(),'B','test-b');
    INSERT INTO users (id,"updatedAt",email,"passwordHash","firstName","lastName","organizationId")
      VALUES ('user-a',NOW(),'a@test.invalid','unused','A','A','org-a'),('user-b',NOW(),'b@test.invalid','unused','B','B','org-b');
    INSERT INTO documents (id,"updatedAt",filename,"displayName","mimeType","sizeBytes","fileType","storagePath",status,"organizationId","uploadedById","embeddingModel")
      VALUES ('doc-a',NOW(),'a.txt','Policy A','text/plain',10,'TXT','/disposable-original-a','COMPLETED','org-a','user-a','all-minilm'),
             ('doc-b',NOW(),'b.txt','Policy B','text/plain',10,'TXT','/disposable-original-b','PROCESSING','org-b','user-b','all-minilm');
    INSERT INTO ai_interactions (id,type,model,"promptTokens","completionTokens","totalTokens","latencyMs","userPrompt",response,"retrievedChunkIds","organizationId")
      VALUES ('legacy-ai','CHAT_MESSAGE','legacy-model',9,4,13,25,'legacy','legacy',ARRAY[]::TEXT[],'org-a');`)
  const legacyVector = `[${Array.from({ length: 384 }, () => 0.1).join(',')}]`
  await client.query('INSERT INTO document_chunks (id,"chunkIndex",text,"tokenCount","documentId",embedding) VALUES ($1,0,$2,5,$3,$4::vector)',
    ['legacy-a', 'Original refund policy text', 'doc-a', legacyVector])
  await client.query(await readFile(`prisma/migrations/${forward}/migration.sql`, 'utf8'))
  const upgraded = await client.query('SELECT embedding,vector_dims("legacyEmbedding") AS dims,"legacyEmbedding"::text AS legacy FROM document_chunks WHERE id=$1', ['legacy-a'])
  assert.equal(upgraded.rows[0].embedding, null)
  assert.equal(upgraded.rows[0].dims, 384)
  assert.equal(upgraded.rows[0].legacy, legacyVector)
  const columns = await client.query(`SELECT attname,format_type(atttypid,atttypmod) AS type
    FROM pg_attribute WHERE attrelid='document_chunks'::regclass AND attname IN ('embedding','legacyEmbedding')`)
  assert.equal(columns.rows.find(row => row.attname === 'embedding')?.type, 'vector(768)')
  assert.equal(columns.rows.find(row => row.attname === 'legacyEmbedding')?.type, 'vector(384)')
  const indexes = await client.query("SELECT indexname FROM pg_indexes WHERE tablename='document_chunks'")
  assert.ok(indexes.rows.some(row => row.indexname === 'document_chunks_pkey'))
  assert.ok(indexes.rows.some(row => row.indexname === 'document_chunks_documentId_chunkIndex_key'))
  const oldDoc = await client.query('SELECT status,"storagePath" FROM documents WHERE id=$1', ['doc-a'])
  assert.equal(oldDoc.rows[0].status, 'FAILED')
  assert.equal(oldDoc.rows[0].storagePath, '/disposable-original-a')
  console.log('PASS historical migration replay and non-destructive forward upgrade')
  for (const migration of migrations.filter((name) => name > forward)) {
    if (migration === '20261012031000_workflow_state_contract') {
      await client.query(`INSERT INTO workflow_runs
        (id,"updatedAt",type,status,input,"organizationId") VALUES
        ('legacy-review',NOW(),'GROUNDED_TECHNICAL_ANSWER','NEEDS_REVIEW','{}','org-a'),
        ('legacy-failed',NOW(),'SALES_EVENT_EXTRACTION','FAILED','{}','org-a')`)
    }
    const sql = await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8')
    if (migration === '20261013010000_document_versions') {
      // PostgreSQL requires a new enum value to commit before a later SQL
      // fixture statement uses it; Prisma deploy also commits this boundary.
      const firstStatementEnd = sql.indexOf(';') + 1
      await client.query(sql.slice(0, firstStatementEnd))
      await client.query(sql.slice(firstStatementEnd))
    } else {
      await client.query(sql)
    }
  }
  const legacyReview = await prisma.workflowRun.findUniqueOrThrow({ where: { id: 'legacy-review' } })
  assert.equal(legacyReview.status, 'COMPLETED')
  assert.equal(legacyReview.reviewStatus, 'REQUIRED')
  assert.equal(legacyReview.deliveryStatus, 'NOT_REQUESTED')
  assert.ok(legacyReview.completedAt)
  const legacyFailed = await prisma.workflowRun.findUniqueOrThrow({ where: { id: 'legacy-failed' } })
  assert.equal(legacyFailed.status, 'FAILED')
  assert.ok(legacyFailed.completedAt)
  console.log('PASS legacy workflow review/failure state preserved with separate review and delivery')
  const legacyActivity = await prisma.workflowRunActivity.findMany({
    where: { workflowRunId: { in: ['legacy-review', 'legacy-failed'] } }, orderBy: { workflowRunId: 'asc' },
  })
  assert.deepEqual(legacyActivity.map(row => [row.workflowRunId, row.kind]),
    [['legacy-failed', 'FAILED'], ['legacy-review', 'COMPLETED']])
  console.log('PASS historical workflow outcomes retained in activity migration')
  const legacyVersion = await prisma.documentVersion.findUniqueOrThrow({ where: { id: 'legacy-doc-a' } })
  assert.equal(legacyVersion.contentHash, null)
  assert.equal(legacyVersion.storagePath, '/disposable-original-a')
  assert.equal((await prisma.documentChunk.findUniqueOrThrow({ where: { id: 'legacy-a' } })).versionId, legacyVersion.id)
  await assert.rejects(prisma.$executeRawUnsafe(
    'UPDATE document_versions SET "contentHash" = $1 WHERE id = $2',
    '0'.repeat(64), legacyVersion.id,
  ))
  await assert.rejects(client.query(`INSERT INTO document_versions
    (id,"documentId","organizationId","versionNumber",filename,"mimeType","sizeBytes","fileType","storagePath",status)
    VALUES ('new-without-hash','doc-a','org-a',99,'a.txt','text/plain',10,'TXT','/disposable-original-a','BUILDING')`))
  const versionIndexes = await client.query("SELECT indexname FROM pg_indexes WHERE tablename='document_chunks'")
  assert.ok(versionIndexes.rows.some(row => row.indexname === 'document_chunks_versionId_chunkIndex_key'))
  console.log('PASS legacy source/chunk IDs, vector and original preserved in version backfill')
  const legacyUsage = await prisma.usageAttempt.findUniqueOrThrow({
    where: { traceId_component_attemptNumber: {
      traceId: 'legacy_trace_legacy-ai', component: 'legacy_ai_interaction', attemptNumber: 1,
    } },
  })
  assert.equal(legacyUsage.measurementStatus, 'UNKNOWN')
  assert.equal(legacyUsage.totalQuantity, null)
  assert.equal(legacyUsage.rateVersion, 'legacy-unavailable-v1')
  assert.ok(await prisma.aiInteraction.findUnique({ where: { id: 'legacy-ai' } }))
  assert.equal(await prisma.draft.count(), 0)
  console.log('PASS legacy AI usage backfilled as unknown rather than zero')
  console.log('PASS draft migration preserves prior interactions and adds an empty draft domain')

  const { persistIngestedChunks } = await import('../../src/modules/documents/ingestionPersistence')
  const { structureAwareChunk } = await import('../../src/services/document/chunking.service')
  const { upsertChunkEmbeddings, searchSimilarChunks } = await import('../../src/utils/vectorSearch')
  const { createGroundedAnswersService } = await import('../../src/modules/groundedAnswers/groundedAnswers.service')
  const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0)
  const chunks = await structureAwareChunk('Refund policy: refunds are available within thirty days of purchase.')
  const makeCandidate = async (documentId: string, organizationId: string) => {
    const document = await prisma.document.findUniqueOrThrow({ where: { id: documentId } })
    const version = await prisma.documentVersion.create({ data: {
      documentId, organizationId, versionNumber: document.nextVersionNumber,
      basedOnVersionId: document.activeVersionId,
      contentHash: '0'.repeat(64),
      filename: document.filename, mimeType: document.mimeType,
      sizeBytes: document.sizeBytes, fileType: document.fileType,
      storagePath: document.storagePath, status: 'BUILDING',
    } })
    await prisma.document.update({ where: { id: documentId }, data: { nextVersionNumber: { increment: 1 } } })
    return { versionId: version.id, expectedActiveVersionId: document.activeVersionId }
  }
  for (const documentId of ['doc-a', 'doc-b']) {
    const candidate = await makeCandidate(documentId, documentId === 'doc-a' ? 'org-a' : 'org-b')
    await prisma.$transaction((tx) => persistIngestedChunks(tx, { documentId, ...candidate,
      chunks, embeddings: chunks.map(() => vector) }, upsertChunkEmbeddings))
  }
  const ready = await prisma.document.findUniqueOrThrow({ where: { id: 'doc-a' } })
  assert.equal(ready.status, 'COMPLETED')
  assert.equal(ready.embeddingModel, 'nomic-embed-text')
  const matches = await searchSimilarChunks({ organizationId: 'org-a', queryVector: vector, queryText: 'refund policy' })
  assert.ok(matches.length > 0)
  assert.ok(matches.every((match) => match.documentId === 'doc-a'))
  assert.deepEqual(await searchSimilarChunks({ organizationId: 'org-a', queryVector: vector, queryText: 'refund policy', documentIds: ['doc-b'] }), [])
  assert.deepEqual(await searchSimilarChunks({ organizationId: 'org-a', queryVector: vector, queryText: 'refund policy', documentIds: [] }), [])
  await prisma.document.update({ where: { id: 'doc-a' }, data: { status: 'DELETED', deletedAt: new Date() } })
  assert.deepEqual(await searchSimilarChunks({ organizationId: 'org-a', queryVector: vector, queryText: 'refund policy' }), [])
  await prisma.document.update({ where: { id: 'doc-a' }, data: { status: 'COMPLETED', deletedAt: null } })
  console.log('PASS chunking, atomic persistence, 768-dimensional vector search and organization isolation')

  const before = await prisma.documentChunk.findMany({ where: { documentId: 'doc-a' } })
  const vectorsBefore = await client.query('SELECT id, embedding::text FROM document_chunks WHERE "documentId"=$1 ORDER BY id', ['doc-a'])
  const candidate = await makeCandidate('doc-a', 'org-a')
  const readyAfterStatusCheck = await prisma.document.findUniqueOrThrow({ where: { id: 'doc-a' } })
  for (const embeddings of [[], [...chunks.map(() => vector), vector]]) {
    await assert.rejects(prisma.$transaction(tx => persistIngestedChunks(tx,
      { documentId: 'doc-a', ...candidate, chunks, embeddings }, upsertChunkEmbeddings)), /Embedding count mismatch/)
    assert.deepEqual(await prisma.documentChunk.findMany({ where: { documentId: 'doc-a' } }), before)
    assert.deepEqual(await prisma.document.findUniqueOrThrow({ where: { id: 'doc-a' } }), readyAfterStatusCheck)
  }
  console.log('PASS missing/extra vector count rejected before transactional replacement')
  await assert.rejects(prisma.$transaction((tx) => persistIngestedChunks(tx,
    { documentId: 'doc-a', ...candidate, chunks, embeddings: chunks.map(() => vector) },
    async (rows, transaction) => { await upsertChunkEmbeddings(rows, transaction); throw new Error('injected interruption') })), /injected interruption/)
  const after = await prisma.documentChunk.findMany({ where: { documentId: 'doc-a' } })
  assert.deepEqual(after, before)
  assert.deepEqual((await client.query('SELECT id, embedding::text FROM document_chunks WHERE "documentId"=$1 ORDER BY id', ['doc-a'])).rows, vectorsBefore.rows)
  assert.deepEqual(await prisma.document.findUniqueOrThrow({ where: { id: 'doc-a' } }), readyAfterStatusCheck)
  console.log('PASS interrupted replacement rolls back chunks and vector writes')

  let generations = 0
  const service = createGroundedAnswersService({
    getEmbeddings: async () => [vector],
    rerank: async ({ items, limit }) => items.slice(0, limit).map((item) => ({ ...item, combinedScore: item.score })),
    callLlm: async () => { generations++; return { text: 'Refunds are available within thirty days of purchase.', model: 'deterministic-test', promptTokens: 10, completionTokens: 10, latencyMs: 1 } },
  })
  assert.equal((await service.answerQuestion({ question: 'What is the refund policy?' }, { organizationId: 'org-a' })).refused, false)
  for (const question of ['quantum spaceship warranty', '']) {
    assert.equal((await service.answerQuestion({ question }, { organizationId: 'org-a' })).refused, true)
  }
  assert.equal((await service.answerQuestion({ question: 'refund policy', documentIds: [] }, { organizationId: 'org-a' })).refused, true)
  assert.equal(generations, 1)
  console.log('PASS real retrieval with stubbed generation, unsupported/empty/scoped refusal')

  const { consumeRefreshToken, resolveCurrentUser } = await import('../../src/modules/auth/sessionPolicy')
  const expiresAt = new Date(Date.now() + 60_000)
  await prisma.refreshToken.create({ data: { token: 'race-original', expiresAt, userId: 'user-a' } })
  const rotate = (token: string) => prisma.$transaction((tx) => consumeRefreshToken(tx, 'race-original', async (user, transaction) => {
    return transaction.refreshToken.create({ data: { token, expiresAt, userId: user.id } })
  }))
  const races = await Promise.allSettled([rotate('race-replacement-a'), rotate('race-replacement-b')])
  assert.equal(races.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(races.filter((result) => result.status === 'rejected').length, 1)
  const loser = races.find((result) => result.status === 'rejected') as PromiseRejectedResult
  assert.equal(loser.reason.statusCode, 401)
  const replacements = await prisma.refreshToken.findMany({ where: { token: { startsWith: 'race-replacement-' } } })
  assert.equal(replacements.length, 1)
  assert.equal(replacements[0]!.isRevoked, false)
  assert.equal((await prisma.refreshToken.findUniqueOrThrow({ where: { token: 'race-original' } })).isRevoked, true)
  await assert.rejects(rotate('race-replacement-replay'), (error: any) => error.statusCode === 401)
  assert.equal((await prisma.refreshToken.findUniqueOrThrow({ where: { id: replacements[0]!.id } })).isRevoked, false)
  assert.equal(await prisma.refreshToken.count({ where: { token: 'race-replacement-replay' } }), 0)
  await prisma.refreshToken.create({ data: { token: 'rollback-original', expiresAt, userId: 'user-a' } })
  await assert.rejects(prisma.$transaction((tx) => consumeRefreshToken(tx, 'rollback-original', async () => {
    throw new Error('replacement failed')
  })), /replacement failed/)
  assert.equal((await prisma.refreshToken.findUniqueOrThrow({ where: { token: 'rollback-original' } })).isRevoked, false)
  const claims = { sub: 'user-a', organizationId: 'org-a', role: 'ADMIN' as const, email: 'a@test.invalid' }
  assert.equal((await resolveCurrentUser(prisma, claims)).role, 'REP')
  await prisma.user.update({ where: { id: 'user-a' }, data: { isActive: false } })
  await assert.rejects(resolveCurrentUser(prisma, claims), /Account access has changed/)
  console.log('PASS real concurrent refresh single winner, rollback and current-role/deactivation checks')
} finally {
  await prisma.$disconnect()
  await client.end()
}
