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
             ('doc-b',NOW(),'b.txt','Policy B','text/plain',10,'TXT','/disposable-original-b','PROCESSING','org-b','user-b','all-minilm');`)
  const legacyVector = `[${Array.from({ length: 384 }, () => 0.1).join(',')}]`
  await client.query('INSERT INTO document_chunks (id,"chunkIndex",text,"tokenCount","documentId",embedding) VALUES ($1,0,$2,5,$3,$4::vector)',
    ['legacy-a', 'Original refund policy text', 'doc-a', legacyVector])
  await client.query(await readFile(`prisma/migrations/${forward}/migration.sql`, 'utf8'))
  const upgraded = await client.query('SELECT embedding,vector_dims("legacyEmbedding") AS dims FROM document_chunks WHERE id=$1', ['legacy-a'])
  assert.equal(upgraded.rows[0].embedding, null)
  assert.equal(upgraded.rows[0].dims, 384)
  const oldDoc = await prisma.document.findUniqueOrThrow({ where: { id: 'doc-a' } })
  assert.equal(oldDoc.status, 'FAILED')
  assert.equal(oldDoc.storagePath, '/disposable-original-a')
  console.log('PASS historical migration replay and non-destructive forward upgrade')
  for (const migration of migrations.filter((name) => name > forward)) {
    await client.query(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'))
  }

  const { persistIngestedChunks } = await import('../../src/modules/documents/ingestionPersistence')
  const { structureAwareChunk } = await import('../../src/services/document/chunking.service')
  const { upsertChunkEmbeddings, searchSimilarChunks } = await import('../../src/utils/vectorSearch')
  const { createGroundedAnswersService } = await import('../../src/modules/groundedAnswers/groundedAnswers.service')
  const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0)
  const chunks = await structureAwareChunk('Refund policy: refunds are available within thirty days of purchase.')
  for (const documentId of ['doc-a', 'doc-b']) {
    await prisma.$transaction((tx) => persistIngestedChunks(tx, { documentId, chunks, embeddings: chunks.map(() => vector), isReingest: true }, upsertChunkEmbeddings))
  }
  const ready = await prisma.document.findUniqueOrThrow({ where: { id: 'doc-a' } })
  assert.equal(ready.status, 'COMPLETED')
  assert.equal(ready.embeddingModel, 'nomic-embed-text')
  const matches = await searchSimilarChunks({ organizationId: 'org-a', queryVector: vector, queryText: 'refund policy' })
  assert.ok(matches.length > 0)
  assert.ok(matches.every((match) => match.documentId === 'doc-a'))
  assert.deepEqual(await searchSimilarChunks({ organizationId: 'org-a', queryVector: vector, queryText: 'refund policy', documentIds: ['doc-b'] }), [])
  assert.deepEqual(await searchSimilarChunks({ organizationId: 'org-a', queryVector: vector, queryText: 'refund policy', documentIds: [] }), [])
  console.log('PASS chunking, atomic persistence, 768-dimensional vector search and organization isolation')

  const before = await prisma.documentChunk.findMany({ where: { documentId: 'doc-a' } })
  const vectorsBefore = await client.query('SELECT id, embedding::text FROM document_chunks WHERE "documentId"=$1 ORDER BY id', ['doc-a'])
  await assert.rejects(prisma.$transaction((tx) => persistIngestedChunks(tx,
    { documentId: 'doc-a', chunks, embeddings: chunks.map(() => vector), isReingest: true },
    async (rows, transaction) => { await upsertChunkEmbeddings(rows, transaction); throw new Error('injected interruption') })), /injected interruption/)
  const after = await prisma.documentChunk.findMany({ where: { documentId: 'doc-a' } })
  assert.deepEqual(after, before)
  assert.deepEqual((await client.query('SELECT id, embedding::text FROM document_chunks WHERE "documentId"=$1 ORDER BY id', ['doc-a'])).rows, vectorsBefore.rows)
  assert.deepEqual(await prisma.document.findUniqueOrThrow({ where: { id: 'doc-a' } }), ready)
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
