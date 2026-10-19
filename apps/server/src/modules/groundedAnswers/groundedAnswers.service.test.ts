import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { hasQuestionEvidence, hasQuestionPartEvidence } from './groundedAnswers.evidence'

// Inert settings; no environment files, database, downloads or live providers.
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused'
process.env.REDIS_URL = 'redis://127.0.0.1:1'
process.env.JWT_ACCESS_SECRET = 'offline-access-secret-32-characters'
process.env.JWT_REFRESH_SECRET = 'offline-refresh-secret-32-characters'
const { createGroundedAnswersService } = await import('./groundedAnswers.service')
const { ProviderOperationError } = await import('../../services/provider/providerTransport')
const source = {
  chunkId: 'chunk-1', text: 'Enterprise customers can enable SAML SSO using their identity provider.',
  chunkIndex: 0, pageNumber: null, headingPath: [], sectionTitle: null,
  versionId: 'version-1', sourceHeadingPath: [], sourceSectionTitle: null,
  documentId: 'document-1', displayName: 'Security guide', filename: 'security.md', score: 2 / 61,
}
function fixture(options: { matches?: typeof source[]; text?: string; outage?: boolean | string } = {}) {
  const searches: any[] = [], generations: any[] = [], embeddings: string[][] = [], embeddingOptions: any[] = [], rerankOperations: any[] = [], localQueries: any[] = []
  const service = createGroundedAnswersService({
    withWorkloadReservation: async ({ work }) => work({ markAttempted() {}, markRefused() {}, usageTraceId: 'trace-test' }),
    prisma: {
      aiInteraction: { create: async () => ({ id: 'interaction-1' }) },
      documentChunk: { findMany: async (input: any) => {
        localQueries.push(input)
        return [{ ...source, id: source.chunkId, document: { id: source.documentId, activeVersionId: source.versionId, displayName: source.displayName, filename: source.filename } }]
      } },
    } as any,
    hasEmbeddingsConfigured: () => true,
    getEmbeddings: async (texts, operation) => { embeddings.push(texts); embeddingOptions.push(operation); return [[1, 0]] },
    searchSimilarChunks: async (params) => {
      searches.push(params)
      if (options.outage) throw new Error(typeof options.outage === 'string' ? options.outage : 'simulated retrieval outage')
      return options.matches ?? [source]
    },
    rerank: async ({ items, limit, operation }) => {
      rerankOperations.push(operation)
      return items.slice(0, limit).map(({ item }) => ({ item, combinedScore: 25 }))
    },
    callLlm: async (params) => {
      generations.push(params)
      return { text: options.text ?? 'Enterprise customers can enable SAML SSO.', model: 'offline-stub', promptTokens: 10, completionTokens: 10, latencyMs: 1 }
    },
  })
  return { service, searches, generations, embeddings, embeddingOptions, rerankOperations, localQueries }
}

// Approved baseline source expectations; this is not a calibrated acceptance corpus.
const evidenceCases: Array<[string, boolean]> = [
  ['Do you offer SAML SSO?', true], ['Can customers enable SAML SSO?', true],
  ['What is your refund policy?', false],
  ['Does your enterprise plan include HIPAA certification?', false],
  ['What is your SSO uptime guarantee and credit policy?', false],
  ['and the what', false], ['   ', false],
]
describe('independent evidence eligibility', () => {
  for (const [question, expected] of evidenceCases) {
    it(question, () => assert.equal(hasQuestionEvidence(question, source.text), expected))
  }
  it('requires whole terms', () => assert.equal(hasQuestionEvidence('port policy', 'Our support policy is documented.'), false))
  it('documents conservative paraphrase refusal', () => {
    assert.equal(hasQuestionEvidence('Can employees authenticate through a corporate identity system?', source.text), false)
  })
  it('requires coverage of every explicit question part', () => {
    assert.equal(hasQuestionEvidence('Can customers enable SAML SSO and refunds?', source.text), true)
    assert.equal(hasQuestionPartEvidence('Can customers enable SAML SSO and refunds?', [source.text]), false)
    assert.equal(hasQuestionPartEvidence('SAML SSO? Refund policy?', [source.text, 'Our refund policy allows refunds.']), true)
  })
})
describe('grounded answers with offline dependencies', () => {
  it('retains low RRF scores and treats logits as ranks, not confidence', async () => {
    const f = fixture()
    const controller = new AbortController()
    const r = await f.service.answerQuestion(
      { question: 'Do you offer SAML SSO?', documentIds: ['document-1'] },
      { organizationId: 'org-a', signal: controller.signal }
    )
    assert.equal(r.refused, false)
    assert.equal(r.confidence, 'LOW')
    assert.equal(r.reviewRequired, true)
    assert.equal(r.citations[0]?.chunkId, 'chunk-1')
    assert.equal(f.searches[0].organizationId, 'org-a')
    assert.deepEqual(f.searches[0].documentIds, ['document-1'])
    assert.equal('minScore' in f.searches[0], false)
    assert.deepEqual(f.embeddings, [['Do you offer SAML SSO?']])
    assert.equal(f.generations.length, 1)
    const deadlines = [
      f.embeddingOptions[0]?.deadlineAtMs,
      f.rerankOperations[0]?.deadlineAtMs,
      f.generations[0]?.operation?.deadlineAtMs,
    ]
    assert.ok(deadlines[0] > Date.now())
    assert.deepEqual(deadlines, [deadlines[0], deadlines[0], deadlines[0]])
    assert.equal(f.embeddingOptions[0]?.signal, controller.signal)
    assert.equal(f.rerankOperations[0]?.signal, controller.signal)
    assert.equal(f.generations[0]?.operation?.signal, controller.signal)
  })
  it('refuses irrelevant neighbors without generation', async () => {
    const f = fixture()
    const r = await f.service.answerQuestion({ question: 'refund policy?' }, { organizationId: 'org-a' })
    assert.equal(r.refused, true)
    assert.deepEqual(r.citations, [])
    assert.equal(f.generations.length, 0)
  })
  it('refuses an empty library', async () => {
    const f = fixture({ matches: [] })
    assert.equal((await f.service.answerQuestion({ question: 'SAML SSO?' }, { organizationId: 'org-a' })).refused, true)
    assert.equal(f.generations.length, 0)
  })
  it('never broadens an empty document scope', async () => {
    const f = fixture()
    assert.equal((await f.service.answerQuestion({ question: 'SAML SSO?', documentIds: [] }, { organizationId: 'org-a' })).refused, true)
    assert.equal(f.embeddings.length, 0)
    assert.equal(f.searches.length, 0)
  })
  for (const text of ['', 'I do not have enough grounded document context to answer this question.']) {
    it('handles empty or refused model output', async () => {
      const f = fixture({ text })
      assert.equal((await f.service.answerQuestion({ question: 'SAML SSO?' }, { organizationId: 'org-a' })).refused, true)
    })
  }
  it('preserves scope and evidence checks on fallback', async () => {
    const f = fixture({ outage: true })
    assert.equal((await f.service.answerQuestion({ question: 'refund policy?' }, { organizationId: 'org-b' })).refused, true)
    assert.equal(f.localQueries[0].where.document.organizationId, 'org-b')
    assert.deepEqual(f.localQueries[0].where.document.activeVersionId, { not: null })
    assert.equal(f.localQueries[0].where.document.deletedAt, null)
  })
  it('logs only a safe category when retrieval fails', async () => {
    const secret = 'provider response contains sensitive content'
    const f = fixture({ outage: secret })
    const originalError = console.error
    const logged: unknown[][] = []
    console.error = (...args: unknown[]) => { logged.push(args) }
    try {
      await f.service.answerQuestion({ question: 'refund policy?' }, { organizationId: 'org-a' })
    } finally {
      console.error = originalError
    }
    assert.equal(JSON.stringify(logged).includes(secret), false)
    assert.deepEqual(logged[0]?.[1], { category: 'internal' })
  })
  for (const outage of [false, true]) {
    it(`refuses partially covered multi-part questions (fallback=${outage})`, async () => {
      const f = fixture({ outage })
      const result = await f.service.answerQuestion({ question: 'Can customers enable SAML SSO and refunds?' }, { organizationId: 'org-a' })
      assert.equal(result.refused, true)
      assert.equal(f.generations.length, 0)
    })
  }
  it('keeps an explicit document allowlist on fallback', async () => {
    const f = fixture({ outage: true })
    await f.service.answerQuestion({ question: 'SAML SSO?', documentIds: ['document-1'] }, { organizationId: 'org-a' })
    assert.deepEqual(f.localQueries[0].where.document, {
      organizationId: 'org-a', deletedAt: null, activeVersionId: { not: null }, id: { in: ['document-1'] },
    })
  })
  it('does not turn provider cancellation or deadline failure into a successful local fallback', async () => {
    for (const category of ['cancelled', 'deadline'] as const) {
      const f = fixture()
      f.service = createGroundedAnswersService({
        withWorkloadReservation: async ({ work }) => work({ markAttempted() {}, markRefused() {}, usageTraceId: 'trace-test' }),
        prisma: {
          aiInteraction: { create: async () => ({ id: 'interaction-1' }) },
          documentChunk: { findMany: async () => { throw new Error('fallback must not run') } },
        } as any,
        hasEmbeddingsConfigured: () => true,
        getEmbeddings: async () => {
          throw new ProviderOperationError('provider stopped', category, [], false)
        },
      })

      await assert.rejects(
        f.service.answerQuestion({ question: 'SAML SSO?' }, { organizationId: 'org-a' }),
        (error: any) => error.category === category
      )
    }
  })
})
