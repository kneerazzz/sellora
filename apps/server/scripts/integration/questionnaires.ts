/** Real questionnaire HTTP/SQL acceptance on the disposable runner only. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import jwt from 'jsonwebtoken'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Questionnaire fixture requires a localhost sellora_test_* target')
}
Object.assign(process.env, { DATABASE_URL: target, NODE_ENV: 'test' })
const { prisma } = await import('../../src/config/prisma')
const { createApp } = await import('../../src/app')
const { questionnairesService } = await import('../../src/modules/questionnaires/questionnaires.service')
const { WorkloadAdmissionError } = await import('../../src/modules/usage/workloadReservations.service')
const { createGroundedAnswersService } = await import('../../src/modules/groundedAnswers/groundedAnswers.service')
const server = createServer(createApp())
try {
  const [org, foreign] = await Promise.all(['own', 'foreign'].map(suffix => prisma.organization.create({
    data: { name: `Questionnaire ${suffix}`, slug: `questionnaire-fixture-${suffix}` },
  })))
  const [user, outsider] = await Promise.all([org, foreign].map((organization, index) => prisma.user.create({
    data: { organizationId: organization.id, email: `questionnaire-${index}@test.invalid`,
      passwordHash: 'unused-fixture-hash', firstName: 'Fixture', lastName: 'Operator', role: 'ADMIN' },
  })))
  const sign = (account: typeof user) => jwt.sign({ sub: account.id, organizationId: account.organizationId,
    email: account.email, role: account.role }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '10m' })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}/api/v1/questionnaires`
  async function request(method: string, path: string, token: string, body?: unknown, expected = 200) {
    const response = await fetch(base + path, { method, headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json',
    }, ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) })
    assert.equal(response.status, expected, `${method} ${path}`)
    return (await response.json() as { data: any }).data
  }
  const ownerToken = sign(user)
  const foreignToken = sign(outsider)
  await request('POST', '', ownerToken, { format: 'TEXT', content: 'x'.repeat(65_537) }, 422)
  assert.equal(await prisma.questionnaireJob.count({ where: { organizationId: org.id } }), 0)
  const job = await request('POST', '', ownerToken, { format: 'CSV',
    content: 'rowId,question\nA,First?\nB,Second?\nC,Third?\n' }, 201)
  assert.equal(job.rows.length, 3)
  assert.deepEqual(job.rows.map((row: { rowId: string }) => row.rowId), ['A', 'B', 'C'])
  await request('GET', `/${job.id}`, foreignToken, undefined, 404)
  const answer = (value: string) => ({ answer: value, refused: false, confidence: 'LOW' as const,
    citations: [], reviewRequired: true as const, aiInteractionId: 'fixture-answer' })
  let secondStarted!: () => void
  let releaseSecond!: () => void
  const reachedSecond = new Promise<void>(resolve => { secondStarted = resolve })
  const blockedSecond = new Promise<void>(resolve => { releaseSecond = resolve })
  const firstWorker = questionnairesService.processNext({ answerQuestion: async question => {
    if (question === 'Second?') { secondStarted(); await blockedSecond }
    return answer('Old worker result')
  } })
  await reachedSecond
  let saved = await questionnairesService.getJob(job.id, org.id)
  assert.deepEqual(saved.rows.map(row => row.status), ['SUCCESS', 'PROCESSING', 'QUEUED'])
  const firstRowId = saved.rows[0]!.id
  await prisma.questionnaireJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1_000) } })
  let replayCalls = 0
  const recovered = await questionnairesService.processNext({ answerQuestion: async () => {
    replayCalls += 1
    return answer('Recovered worker result')
  } })
  assert.equal(replayCalls, 2)
  assert.equal(recovered?.status, 'COMPLETED')
  assert.deepEqual(recovered?.rows.map(row => [row.rowId, row.status, row.attemptCount]), [
    ['A', 'SUCCESS', 1], ['B', 'SUCCESS', 2], ['C', 'SUCCESS', 1],
  ])
  assert.equal(recovered?.rows[0].id, firstRowId)
  releaseSecond()
  await firstWorker
  saved = await questionnairesService.getJob(job.id, org.id)
  assert.equal(saved.rows[1].answer, 'Recovered worker result')
  assert.equal(saved.rows[0].answer, 'Old worker result')

  const failed = await request('POST', '', ownerToken, { format: 'TEXT', content: 'Retry this?' }, 201)
  await questionnairesService.processNext({ answerQuestion: async () => { throw new Error('synthetic failure') } })
  saved = await questionnairesService.getJob(failed.id, org.id)
  assert.equal(saved.rows[0].status, 'ERROR')
  assert.equal(saved.rows[0].attemptCount, 1)
  await request('POST', `/${failed.id}/rows/0/retry`, ownerToken)
  await questionnairesService.processNext({ answerQuestion: async () => answer('Retried successfully') })
  saved = await questionnairesService.getJob(failed.id, org.id)
  assert.equal(saved.rows[0].status, 'SUCCESS')
  assert.equal(saved.rows[0].attemptCount, 2)
  await request('POST', `/${failed.id}/rows/0/retry`, ownerToken, undefined, 409)

  const exhausted = await request('POST', '', ownerToken, { format: 'TEXT', content: 'Exhaust retries?' }, 201)
  await questionnairesService.processNext({ answerQuestion: async () => { throw new Error('first failure') } })
  await request('POST', `/${exhausted.id}/rows/0/retry`, ownerToken)
  await questionnairesService.processNext({ answerQuestion: async () => { throw new Error('second failure') } })
  await request('POST', `/${exhausted.id}/rows/0/retry`, ownerToken, undefined, 409)
  assert.equal((await questionnairesService.getJob(exhausted.id, org.id)).rows[0].attemptCount, 2)

  const paused = await request('POST', '', ownerToken, { format: 'TEXT', content: 'Wait for allowance?' }, 201)
  await questionnairesService.processNext({ answerQuestion: async () => {
    throw new WorkloadAdmissionError('Synthetic pause', 'paused')
  } })
  saved = await questionnairesService.getJob(paused.id, org.id)
  assert.equal(saved.status, 'QUEUED')
  assert.equal(saved.rows[0].attemptCount, 0)
  await request('POST', `/${paused.id}/cancel`, ownerToken)

  const cancel = await request('POST', '', ownerToken, { format: 'TEXT', content: 'One?\nTwo?' }, 201)
  const cancelled = await request('POST', `/${cancel.id}/cancel`, ownerToken)
  assert.equal(cancelled.status, 'CANCELLED')
  assert.deepEqual(cancelled.rows.map((row: { status: string }) => row.status), ['CANCELLED', 'CANCELLED'])
  const active = await request('POST', '', ownerToken, { format: 'TEXT', content: 'In flight?\nLater?' }, 201)
  let activeStarted!: () => void
  let activeRelease!: () => void
  const activeReached = new Promise<void>(resolve => { activeStarted = resolve })
  const activeBlocked = new Promise<void>(resolve => { activeRelease = resolve })
  const activeWorker = questionnairesService.processNext({ answerQuestion: async () => {
    activeStarted()
    await activeBlocked
    return answer('Too late')
  } })
  await activeReached
  await request('POST', `/${active.id}/cancel`, ownerToken)
  activeRelease()
  await activeWorker
  const stopped = await questionnairesService.getJob(active.id, org.id)
  assert.deepEqual(stopped.rows.map(row => row.status), ['CANCELLED', 'CANCELLED'])
  assert.ok(stopped.rows.every(row => row.answer === null))
  assert.equal(await questionnairesService.processNext({ answerQuestion: async () => { throw Error('Unexpected provider call') } }), null)
  const traced = await request('POST', '', ownerToken, { format: 'TEXT', content: 'What is unsupported?' }, 201)
  const localAnswers = createGroundedAnswersService({ hasEmbeddingsConfigured: () => false })
  await questionnairesService.processNext({ answerQuestion: (question, documentIds, requestId) =>
    localAnswers.answerQuestion({ question, documentIds }, { organizationId: org.id, requestId }) })
  const tracedResult = await questionnairesService.getJob(traced.id, org.id)
  assert.equal(tracedResult.rows[0].status, 'REFUSAL')
  const usage = await prisma.usageTrace.findFirst({ where: { organizationId: org.id,
    requestId: `questionnaire:${traced.id}:0:1`, operation: 'grounded_answer' } })
  assert.ok(usage?.reservationId)
  console.log('PASS questionnaire HTTP bounds/tenant, persisted rows, expired lease recovery, retry cap, cancellation and real local reservation')
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await prisma.$disconnect()
}
