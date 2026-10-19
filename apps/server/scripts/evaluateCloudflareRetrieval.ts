import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { env } from '../src/config/env'
import { prisma } from '../src/config/prisma'
import { getEmbeddings } from '../src/utils/embeddings'
import { searchSimilarChunks } from '../src/utils/vectorSearch'
import { hasQuestionEvidence } from '../src/modules/groundedAnswers/groundedAnswers.evidence'

type Case = { id: string; question: string; expectedAnswer: string | null; expectedSource: string | null; expectedOutcome?: 'CLARIFY' }
type Fixture = { organizationSlug: string; tag: string; cases: Case[] }

const target = new URL(env.DATABASE_URL)
assert.equal(target.hostname, 'localhost', 'Use only the selected local test database')
assert.equal(decodeURIComponent(target.pathname.slice(1)), 'neer_db', 'Use only the selected local test database')

const fixture = JSON.parse(await readFile(new URL('../../../docs/evidence/cloudflare-questions-v1.json', import.meta.url), 'utf8')) as Fixture
assert.equal(fixture.cases.length, 25)
assert.equal(new Set(fixture.cases.map(item => item.id)).size, fixture.cases.length)
assert(fixture.cases.every(item => item.id && item.question.trim().length >= 3 &&
  (item.expectedSource ? item.expectedAnswer : item.expectedAnswer === null || item.expectedOutcome === 'CLARIFY')))

try {
  const organizations = await prisma.organization.findMany({ select: { id: true, slug: true } })
  assert.equal(organizations.length, 1)
  assert.equal(organizations[0].slug, fixture.organizationSlug)
  const organizationId = organizations[0].id
  const documents = await prisma.document.findMany({
    where: { organizationId, tags: { has: fixture.tag }, status: 'COMPLETED', deletedAt: null },
    select: { id: true, description: true },
  })
  assert.equal(documents.length, 500, 'The pinned 500-page corpus must be complete')

  let answerable = 0, hit5 = 0, hit30 = 0, eligibleExpected = 0, unsupported = 0, lexicalAccepted = 0
  for (const item of fixture.cases) {
    const expected = item.expectedSource
      ? documents.filter(document => document.description?.includes(`/src/content/docs/${item.expectedSource};`))
      : []
    if (item.expectedSource) assert.equal(expected.length, 1, `Expected one source for ${item.id}`)
    const [queryVector] = await getEmbeddings([item.question], { isQuery: true })
    assert(queryVector, `Missing query vector for ${item.id}`)
    const matches = await searchSimilarChunks({ organizationId, queryVector, queryText: item.question, topK: 30 })
    const eligible = matches.filter(match => hasQuestionEvidence(item.question, match.text))
    const rank = expected.length ? matches.findIndex(match => match.documentId === expected[0].id) + 1 : null
    const expectedEligible = expected.length ? eligible.some(match => match.documentId === expected[0].id) : null
    if (expected.length) {
      answerable++
      if (rank && rank <= 5) hit5++
      if (rank) hit30++
      if (expectedEligible) eligibleExpected++
    } else {
      unsupported++
      if (eligible.length) lexicalAccepted++
    }
    console.log(JSON.stringify({ id: item.id, rank: rank || null, expectedEligible, eligibleChunks: eligible.length,
      expectedOutcome: item.expectedOutcome ?? (expected.length ? 'ANSWER' : 'REFUSE'),
      topSources: matches.slice(0, 3).map(match => match.displayName) }))
  }
  console.log(JSON.stringify({ summary: { answerable, hit5, hit30, eligibleExpected, unsupported, lexicalAccepted } }))
} finally {
  await prisma.$disconnect()
}
