/** Synthetic profiling on the owned disposable database only. No model or provider calls. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { hostname, cpus, totalmem, platform, release } from 'node:os'
import { performance } from 'node:perf_hooks'
import pg from 'pg'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Set SELLORA_DISPOSABLE_DATABASE_URL')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Performance target must be a disposable localhost database')
}
const client = new pg.Client({ connectionString: target })
await client.connect()
const { prisma } = await import('../../src/config/prisma')
const { searchSimilarChunks } = await import('../../src/utils/vectorSearch')
const { extractDocumentText } = await import('../../src/services/document/documentProcessing.service')
const { structureAwareChunk } = await import('../../src/services/document/chunking.service')
const { createGroundedAnswersService } = await import('../../src/modules/groundedAnswers/groundedAnswers.service')
const vector = `[${Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0).join(',')}]`
const queryVector = Array.from({ length: 768 }, (_, i) => i === 0 ? 1 : 0)
const sample = 'Refund policy permits return within thirty days.\n\n'
const cases = [
  { name: 'small', characters: 2_000, chunks: 12 },
  { name: 'medium', characters: 100_000, chunks: 160 },
  { name: 'large', characters: 250_000, chunks: 1200 },
]
const result: Record<string, unknown> = {
  manifest: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, totalMemoryBytes: totalmem(), host: createHash('sha256').update(hostname()).digest('hex').slice(0, 12),
    corpus: 'synthetic-refund-v1', vectorDimensions: 768, provider: 'deterministic-no-network', samplesPerCase: 4 },
  cases: [],
}
const timed = async <T>(work: () => Promise<T>) => {
  const start = performance.now()
  const value = await work()
  return { value, ms: +(performance.now() - start).toFixed(3), rssBytes: process.memoryUsage().rss }
}

try {
  await client.query('DROP INDEX IF EXISTS document_chunks_text_search_idx')
  for (const item of cases) {
    const doc = `bench-${item.name}`
    const version = `${doc}-v1`
    const text = sample.repeat(Math.ceil(item.characters / sample.length)).slice(0, item.characters)
    const bytes = Buffer.from(text)
    const parsing = []
    const chunking = []
    for (let i = 0; i < 4; i++) {
      const parsed = await timed(() => extractDocumentText({ fileType: 'TXT', buffer: bytes }))
      const chunked = await timed(() => structureAwareChunk(parsed.value.text))
      assert.ok(chunked.value.length > 0)
      parsing.push({ ms: parsed.ms, rssBytes: parsed.rssBytes })
      chunking.push({ ms: chunked.ms, rssBytes: chunked.rssBytes, chunks: chunked.value.length })
    }
    await client.query(`INSERT INTO organizations (id, "updatedAt", name, slug) VALUES ($1,NOW(),$1,$1)`, [doc])
    await client.query(`INSERT INTO users (id,"updatedAt",email,"passwordHash","firstName","lastName","organizationId")
      VALUES ($1,NOW(),$2,'unused','Bench','User',$3)`, [`${doc}-user`, `${doc}@test.invalid`, doc])
    await client.query(`INSERT INTO documents
      (id,"updatedAt",filename,"displayName","mimeType","sizeBytes","fileType","storagePath",status,"organizationId","uploadedById")
      VALUES ($1,NOW(),'synthetic.txt','Synthetic policy','text/plain',$2,'TXT','/disposable-only','COMPLETED',$3,$4)`,
      [doc, bytes.length, doc, `${doc}-user`])
    await client.query(`INSERT INTO document_versions
      (id,"updatedAt","documentId","organizationId","versionNumber",filename,"mimeType","sizeBytes","fileType","storagePath",status,"contentHash")
      VALUES ($1,NOW(),$2,$3,1,'synthetic.txt','text/plain',$4,'TXT','/disposable-only','ACTIVE',$5)`,
      [version, doc, doc, bytes.length, createHash('sha256').update(bytes).digest('hex')])
    await client.query('UPDATE documents SET "activeVersionId"=$1 WHERE id=$2', [version, doc])
    const insert = await timed(() => client.query(`INSERT INTO document_chunks
      (id,"chunkIndex",text,"tokenCount","documentId","versionId","headingPath",embedding)
      SELECT $1 || '-' || n, n-1,
        CASE WHEN n % 10 = 0 THEN 'Refund policy permits return within thirty days.' ELSE 'Synthetic unrelated procedure section ' || n END,
        12,$1,$2,ARRAY[]::text[],$3::vector
      FROM generate_series(1,$4) AS n`, [doc, version, vector, item.chunks]))
    await client.query('ANALYZE document_chunks')
    await client.query('ANALYZE documents')
    await client.query('ANALYZE document_versions')
    const searchArgs = { organizationId: doc, queryVector, queryText: 'refund policy', topK: 20, documentIds: [doc] }
    const search = []
    let baselineIds: string[] = []
    for (let i = 0; i < 4; i++) {
      const run = await timed(() => searchSimilarChunks(searchArgs))
      assert.ok(run.value.length > 0 && run.value.every(row => row.documentId === doc && row.versionId === version))
      if (i === 3) baselineIds = run.value.map(row => row.chunkId)
      search.push({ ms: run.ms, rssBytes: run.rssBytes, returned: run.value.length })
    }
    const answerPhases = []
    for (let i = 0; i < 4; i++) {
      const phases: Record<string, number> = {}
      const phase = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
        const start = performance.now()
        const value = await work()
        phases[name] = +(performance.now() - start).toFixed(3)
        return value
      }
      const service = createGroundedAnswersService({
        getEmbeddings: async () => phase('embeddingStubMs', async () => [queryVector]),
        searchSimilarChunks: async args => phase('retrievalMs', () => searchSimilarChunks(args)),
        rerank: async ({ items, limit }) => phase('rerankerStubMs', async () => items.slice(0, limit).map(entry => ({ ...entry, combinedScore: entry.score }))),
        callLlm: async () => phase('generationStubMs', async () => ({
          text: 'Returns are permitted within thirty days.', model: 'deterministic-benchmark',
          promptTokens: 10, completionTokens: 10, latencyMs: 0,
        })),
      })
      const answer = await timed(() => service.answerQuestion({ question: 'What is the refund policy?', documentIds: [doc] }, { organizationId: doc }))
      assert.equal(answer.value.refused, false)
      assert.ok(answer.value.citations.every(citation => citation.documentId === doc && citation.versionId === version))
      answerPhases.push({ ...phases, totalMs: answer.ms, rssBytes: answer.rssBytes, citationCount: answer.value.citations.length })
    }
    assert.deepEqual(await searchSimilarChunks({ ...searchArgs, organizationId: 'foreign' }), [])
    assert.deepEqual(await searchSimilarChunks({ ...searchArgs, documentIds: [] }), [])
    const original = prisma.$queryRaw
    let captured: { text: string; values: unknown[] } | undefined
    try {
      prisma.$queryRaw = (async (query: typeof captured) => { captured = query; return [] }) as typeof original
      await searchSimilarChunks(searchArgs)
    } finally {
      prisma.$queryRaw = original
    }
    assert.ok(captured)
    const explain = async () => (await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${captured.text}`, captured.values)).rows[0]['QUERY PLAN'][0]
    const baselinePlans = [await explain(), await explain(), await explain()]
    await client.query(`CREATE INDEX document_chunks_text_search_idx ON document_chunks USING GIN (to_tsvector('english', text))`)
    await client.query('ANALYZE document_chunks')
    const candidatePlans = [await explain(), await explain(), await explain()]
    const candidate = await searchSimilarChunks(searchArgs)
    assert.deepEqual(candidate.map(row => row.chunkId), baselineIds)
    await client.query(`UPDATE document_versions SET status='RETIRED' WHERE id=$1`, [version])
    assert.deepEqual(await searchSimilarChunks(searchArgs), [])
    await client.query(`UPDATE document_versions SET status='ACTIVE' WHERE id=$1`, [version])
    await client.query(`UPDATE documents SET status='DELETED',"deletedAt"=NOW() WHERE id=$1`, [doc])
    assert.deepEqual(await searchSimilarChunks(searchArgs), [])
    await client.query(`UPDATE documents SET status='COMPLETED',"deletedAt"=NULL WHERE id=$1`, [doc])
    await client.query('DROP INDEX document_chunks_text_search_idx')
    const nodes = (plan: any): unknown[] => [{ type: plan['Node Type'], relation: plan['Relation Name'],
      index: plan['Index Name'], rows: plan['Actual Rows'], filter: plan.Filter, indexCondition: plan['Index Cond'] },
      ...(plan.Plans ?? []).flatMap(nodes)]
    const planSummary = (plans: any[]) => plans.map(plan => ({ executionMs: plan['Execution Time'],
      sharedHitBlocks: plan.Plan['Shared Hit Blocks'], sharedReadBlocks: plan.Plan['Shared Read Blocks'], nodes: nodes(plan.Plan) }))
    ;(result.cases as unknown[]).push({ ...item, textSha256: createHash('sha256').update(bytes).digest('hex'),
      parser: parsing, chunker: chunking, answerPhases,
      insert: { ms: insert.ms, queryCount: 1 }, search: { runs: search, queryCountPerRun: 1 },
      plans: { baseline: planSummary(baselinePlans), candidateGin: planSummary(candidatePlans) } })
  }
  await writeFile('../../docs/evidence/performance-raw.json', `${JSON.stringify(result, null, 2)}\n`)
  console.log('PASS synthetic profile, scoped retrieval and temporary index comparison')
} finally {
  await prisma.$disconnect()
  await client.end()
}
