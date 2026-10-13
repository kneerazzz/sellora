/** Real auth/upload/parser/storage/SQL path; only the Ollama HTTP endpoint is stubbed. */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { performance } from 'node:perf_hooks'
import jwt from 'jsonwebtoken'
import { docxFixture, pdfFixture } from './documentFixtures'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('HTTP harness requires a localhost sellora_test_* target')
}
const storage = await mkdtemp(path.join(tmpdir(), 'sellora-http-'))
const vector = Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0)
let responseVector: unknown = vector
let embeddingEntered = false
let releaseEmbedding: (() => void) | undefined
let embeddingGate: Promise<void> | undefined
let wrongModel = false
const stub = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const input = JSON.parse(body) as { model: string; prompt: string }
  if (req.url !== '/api/embeddings' || input.model !== 'nomic-embed-text' || !input.prompt.startsWith('search_document: ')) {
    wrongModel = true
    res.writeHead(400).end('{}')
    return
  }
  embeddingEntered = true
  if (embeddingGate) await embeddingGate
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ embedding: responseVector }))
})

async function listen(server: Server) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}
const endpoint = await listen(stub)
Object.assign(process.env, {
  DATABASE_URL: target, NODE_ENV: 'test', DOCUMENT_STORAGE_DIR: storage,
  LOCAL_EMBEDDING_SERVICE_URL: endpoint, EMBEDDING_PROVIDER: 'local',
})
const { prisma } = await import('../../src/config/prisma')
let api: Server | undefined
try {
  assert.equal(await prisma.organization.count(), 0, 'HTTP test requires an empty migrated database')
  const { createApp } = await import('../../src/app')
  const { searchSimilarChunks } = await import('../../src/utils/vectorSearch')
  const { documentsService } = await import('../../src/modules/documents/documents.service')
  const org = await prisma.organization.create({ data: { name: 'HTTP fixture', slug: 'http-fixture' } })
  const other = await prisma.organization.create({ data: { name: 'Other fixture', slug: 'other-fixture' } })
  const users = await Promise.all([org, other].map((organization, i) => prisma.user.create({
    data: { organizationId: organization.id, email: `http-${i}@test.invalid`, passwordHash: 'unused', firstName: 'Test', lastName: 'User', role: 'ADMIN' },
  })))
  const tokens = users.map(user => jwt.sign({ sub: user.id, organizationId: user.organizationId, email: user.email, role: user.role }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '5m' }))
  api = createServer(createApp())
  const base = await listen(api)
  const request = (route: string, body: unknown, token = tokens[0]!) => fetch(`${base}/api/v1/documents${route}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  })
  const upload = async (name: string, text: string | Buffer, type = 'text/plain') => {
    const started = performance.now()
    const rssBefore = process.memoryUsage().rss
    const form = new FormData()
    form.set('file', new Blob([typeof text === 'string' ? text : new Uint8Array(text)], { type }), name)
    const result = await fetch(`${base}/api/v1/documents/upload-file`, {
      method: 'POST', headers: { authorization: `Bearer ${tokens[0]}` }, body: form,
      signal: AbortSignal.timeout(30_000),
    })
    if (['policy.txt', 'policy.md', 'policy.pdf', 'policy.docx'].includes(name)) {
      const bytes = typeof text === 'string' ? Buffer.byteLength(text) : text.length
      console.log(`MEASURE upload ${name}: ${bytes} bytes, ${Math.round(performance.now() - started)} ms, RSS before/after ${Math.round(rssBefore / 1024 / 1024)}/${Math.round(process.memoryUsage().rss / 1024 / 1024)} MiB, status ${result.status}`)
    }
    return result
  }
  const original = 'Refund policy: refunds are available within thirty days of purchase.'
  const response = await upload('policy.txt', original)
  assert.equal(response.status, 201)
  const document = (await response.json() as { data: { id: string; status: string } }).data
  assert.equal(document.status, 'COMPLETED')
  const id = document.id
  const matches = await searchSimilarChunks({ organizationId: org.id, queryVector: vector, queryText: 'refund policy' })
  assert.ok(matches.some(match => match.documentId === id))
  assert.deepEqual(await searchSimilarChunks({ organizationId: other.id, queryVector: vector, queryText: 'refund policy' }), [])
  assert.equal((await request(`/${id}/ingest-text`, { text: original }, tokens[1])).status, 404)

  for (const [name, bytes, mime] of [
    ['policy.md', `# Refund policy\n\n${original}`, 'text/markdown'],
    ['policy.pdf', pdfFixture(original), 'application/pdf'],
    ['policy.docx', docxFixture(original), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ] as const) {
    const result = await upload(name, bytes, mime)
    assert.equal(result.status, 201, name)
    const uploaded = (await result.json() as { data: { id: string } }).data
    const persisted = await prisma.document.findUniqueOrThrow({ where: { id: uploaded.id } })
    assert.equal(persisted.status, 'COMPLETED')
    assert.equal(persisted.embeddingModel, 'nomic-embed-text')
    if (name.endsWith('.pdf')) assert.equal(persisted.pageCount, 1)
    assert.deepEqual(await readFile(persisted.storagePath), typeof bytes === 'string' ? Buffer.from(bytes) : bytes)
    const chunks = await prisma.documentChunk.findMany({ where: { documentId: uploaded.id } })
    assert.ok(chunks.some(chunk => chunk.text.includes('refunds are available within thirty days')))
    assert.ok((await searchSimilarChunks({ organizationId: org.id, queryVector: vector, queryText: 'refund policy', documentIds: [uploaded.id] })).length > 0)
  }
  console.log('PASS real multipart TXT/Markdown/PDF/DOCX parse, originals, model metadata and scoped search')

  const duplicate = await upload('policy.txt', original)
  assert.equal(duplicate.status, 201)
  assert.notEqual((await duplicate.json() as { data: { id: string } }).data.id, id)
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await request(`/${id}/ingest-text`, { text: original })).status, 200)
    assert.equal(await prisma.documentChunk.count({ where: { documentId: id } }), 1)
  }
  assert.equal((await request(`/${id}/ingest-text`, { text: original, embeddingModel: 'all-minilm' })).status, 422)

  const filesBefore = await readdir(storage, { recursive: true })
  for (const [name, mime] of [['broken.pdf', 'application/pdf'], ['broken.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
    const malformed = await upload(name!, 'not a document', mime)
    assert.ok(malformed.status >= 400)
    assert.deepEqual(await readdir(storage, { recursive: true }), filesBefore)
  }
  const empty = await upload('empty.txt', '   ')
  assert.equal(empty.status, 400)
  const emptyDocument = await prisma.document.findFirstOrThrow({ where: { filename: 'empty.txt' } })
  assert.equal(emptyDocument.status, 'FAILED')
  assert.equal(await prisma.documentChunk.count({ where: { documentId: emptyDocument.id } }), 0)
  assert.equal((await readFile(emptyDocument.storagePath, 'utf8')), '   ')
  const filesAfterEmpty = await readdir(storage, { recursive: true })
  await assert.rejects(documentsService.uploadDocument({ filename: 'unowned.txt', content: original }, {
    organizationId: org.id, userId: 'missing-user',
  }))
  assert.deepEqual(await readdir(storage, { recursive: true }), filesAfterEmpty)

  embeddingEntered = false
  embeddingGate = new Promise(resolve => { releaseEmbedding = resolve })
  const replacement = request(`/${id}/ingest-text`, { text: original })
  for (let i = 0; i < 200 && !embeddingEntered; i++) await delay(25)
  assert.equal(embeddingEntered, true)
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id } })).status, 'PROCESSING')
  const transactions = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'`
  assert.equal(Number(transactions[0]!.count), 0, 'No persistence transaction is held while embedding waits')
  assert.deepEqual(await searchSimilarChunks({ organizationId: org.id, queryVector: vector, queryText: 'refund policy', documentIds: [id] }), [])
  assert.equal((await request(`/${id}/ingest-text`, { text: 'Competing content' })).status, 409)
  releaseEmbedding!()
  embeddingGate = undefined
  assert.equal((await replacement).status, 200)
  assert.equal((await prisma.document.findUniqueOrThrow({ where: { id } })).status, 'COMPLETED')
  assert.equal(await prisma.documentChunk.count({ where: { documentId: id } }), 1)
  assert.ok((await prisma.documentChunk.findMany({ where: { documentId: id } })).every(chunk => !chunk.text.includes('Competing content')))

  for (const malformed of [undefined, [], [1, 2], vector.map(() => 0), vector.map(() => null), vector.map(() => '1'), vector.map((v, i) => i === 0 ? 1e309 : v)]) {
    const before = await prisma.documentChunk.findMany({ where: { documentId: id } })
    responseVector = malformed
    assert.ok((await request(`/${id}/ingest-text`, { text: original })).status >= 400)
    responseVector = vector
    assert.deepEqual(await prisma.documentChunk.findMany({ where: { documentId: id } }), before)
    assert.equal((await prisma.document.findUniqueOrThrow({ where: { id } })).status, 'FAILED')
    const failed = await prisma.document.findUniqueOrThrow({ where: { id } })
    assert.equal(await readFile(failed.storagePath, 'utf8'), original)
    assert.equal((await request(`/${id}/ingest-text`, { text: original })).status, 200)
  }
  responseVector = [1, 2]
  assert.ok((await upload('failed-vector.txt', original)).status >= 400)
  responseVector = vector
  const failedUpload = await prisma.document.findFirstOrThrow({ where: { filename: 'failed-vector.txt' } })
  assert.equal(failedUpload.status, 'FAILED')
  assert.equal(failedUpload.embeddingModel, null)
  assert.equal(await prisma.documentChunk.count({ where: { documentId: failedUpload.id } }), 0)
  assert.equal(await readFile(failedUpload.storagePath, 'utf8'), original)

  // Fail a real vector UPDATE after replacement has started, then prove rollback.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_fixture_vector() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.text LIKE '%SQL_FAIL%' THEN RAISE EXCEPTION 'fixture write interruption'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_vector_failure BEFORE UPDATE OF embedding ON document_chunks FOR EACH ROW EXECUTE FUNCTION fail_fixture_vector()')
  const rowsBefore = await prisma.documentChunk.findMany({ where: { documentId: id } })
  const vectorBefore = await prisma.$queryRaw<Array<{ id: string; embedding: string }>>`SELECT id, embedding::text FROM document_chunks WHERE "documentId"=${id} ORDER BY id`
  assert.ok((await request(`/${id}/ingest-text`, { text: `${original} SQL_FAIL` })).status >= 400)
  assert.deepEqual(await prisma.documentChunk.findMany({ where: { documentId: id } }), rowsBefore)
  assert.deepEqual(await prisma.$queryRaw`SELECT id, embedding::text FROM document_chunks WHERE "documentId"=${id} ORDER BY id`, vectorBefore)
  await prisma.$executeRawUnsafe('DROP TRIGGER fixture_vector_failure ON document_chunks')
  await prisma.$executeRawUnsafe('DROP FUNCTION fail_fixture_vector()')
  assert.equal((await request(`/${id}/ingest-text`, { text: original })).status, 200)
  assert.equal(wrongModel, false)
  console.log('PASS real HTTP upload/parser/storage/search, tenant scope, duplicate/retry, concurrent claim, no premature readiness and failed-vector rollback')
} finally {
  releaseEmbedding?.()
  for (const server of [api, stub]) {
    if (server) {
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }
  await prisma.$disconnect()
  await rm(storage, { recursive: true, force: true })
}
