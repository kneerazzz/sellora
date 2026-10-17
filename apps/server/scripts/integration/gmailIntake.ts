/** Selected Gmail/n8n contract over real API and an explicitly disposable database. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Gmail fixture requires a localhost sellora_test_* target')
}
process.env.DATABASE_URL = target
process.env.NODE_ENV = 'test'

const { prisma } = await import('../../src/config/prisma')
const { sha256Hex } = await import('../../src/utils/crypto')
const { createApp } = await import('../../src/app')
const workflow = JSON.parse(await readFile(new URL('../../../../n8n/sellora-gmail-intake-workflow.json', import.meta.url), 'utf8')) as {
  active: boolean; nodes: Array<{ name: string; type: string; parameters: Record<string, any>; credentials?: unknown }>
}
assert.equal(workflow.active, false)
assert.equal(workflow.nodes.length, 3)
assert.ok(workflow.nodes.every(node => !node.credentials))
const trigger = workflow.nodes.find(node => node.type === 'n8n-nodes-base.gmailTrigger')!
assert.equal(trigger.parameters.simple, false)
assert.equal(trigger.parameters.maxResults, 10)
assert.match(trigger.parameters.filters.q, /-has:attachment/)
const sender = workflow.nodes.find(node => node.type === 'n8n-nodes-base.httpRequest')!
assert.equal(sender.parameters.authentication, 'genericCredentialType')
assert.ok(sender.parameters.url.endsWith('/api/v1/webhooks/gmail-received'))
assert.equal(sender.parameters.jsonBody, '={{ $json }}')
const normalize = workflow.nodes.find(node => node.type === 'n8n-nodes-base.code')!
const mapMessage = (input: unknown) => runInNewContext(`(function () { const $json = input; ${normalize.parameters.jsCode} })()`, { input }) as { json: Record<string, unknown> }
const raw = { id: '18f0a1b2c3d4e5f6', threadId: '18f0a1b2c3d4e5f6',
  from: { value: [{ address: 'buyer@example.test' }] }, to: { value: [{ address: 'pilot@example.test' }] },
  subject: 'Refund policy question', text: 'Can you explain the refund window?', date: new Date().toISOString(), sizeEstimate: 1024 }
const message = mapMessage(raw).json
assert.deepEqual(Object.keys(message), ['version', 'messageId', 'threadId', 'from', 'to', 'subject', 'text', 'messageDate', 'sizeEstimate'])
assert.throws(() => mapMessage({ ...raw, id: undefined }), /required intake fields/)
assert.throws(() => mapMessage({ ...raw, sizeEstimate: 131073 }), /intake limit/)

const api = createServer(createApp())
try {
  const [org, foreign] = await Promise.all(['a', 'b'].map(suffix => prisma.organization.create({
    data: { name: `Gmail intake ${suffix}`, slug: `gmail-intake-${suffix}` },
  })))
  const keys = await Promise.all([org, foreign].map(async (organization, index) => {
    const rawKey = `gmail-fixture-key-${index}`
    await prisma.apiKey.create({ data: { organizationId: organization.id, label: 'Gmail fixture',
      scope: 'WEBHOOK_ONLY', keyHash: sha256Hex(rawKey), keyPrefix: 'gmail-fixture' } })
    return rawKey
  }))
  const readOnly = 'gmail-fixture-read-only'
  await prisma.apiKey.create({ data: { organizationId: org.id, label: 'Wrong scope',
    scope: 'READ_ONLY', keyHash: sha256Hex(readOnly), keyPrefix: 'gmail-fixture' } })
  api.listen(0, '127.0.0.1')
  await once(api, 'listening')
  const address = api.address()
  assert.ok(address && typeof address === 'object')
  const endpoint = `http://127.0.0.1:${address.port}/api/v1/webhooks/gmail-received`
  async function post(body: unknown, key?: string, extraHeaders: Record<string, string> = {}, query = '') {
    const response = await fetch(endpoint + query, { method: 'POST', headers: {
      'content-type': 'application/json', ...(key && { authorization: `Bearer ${key}` }), ...extraHeaders,
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) })
    return { status: response.status, data: (await response.json() as { data: any }).data }
  }
  assert.equal((await post(message)).status, 401)
  assert.equal((await post(message, readOnly)).status, 403)
  assert.equal((await post({ ...message, organizationId: foreign.id }, keys[0])).status, 403)
  assert.equal((await post({ ...message, source: 'OUTLOOK' }, keys[0])).status, 422)
  assert.equal((await post({ ...message, version: 2 }, keys[0])).status, 422)
  assert.equal((await post({ ...message, threadId: '' }, keys[0])).status, 422)
  assert.equal((await post({ ...message, from: 'not an address' }, keys[0])).status, 422)
  assert.equal((await post({ ...message, text: 'x'.repeat(16001) }, keys[0])).status, 422)
  assert.equal((await post({ ...message, attachment: 'base64-bytes' }, keys[0])).status, 422)
  assert.equal((await post(message, keys[0], { 'Idempotency-Key': 'override' })).status, 400)
  assert.equal((await post(message, keys[0], {}, '?process=true')).status, 422)

  const first = await post(message, keys[0])
  assert.equal(first.status, 202)
  assert.equal(first.data.version, 1)
  const repeat = await post(message, keys[0])
  assert.equal(repeat.status, 202)
  assert.equal(repeat.data.webhookEventId, first.data.webhookEventId)
  assert.equal(repeat.data.workflowRunId, first.data.workflowRunId)
  assert.equal((await post({ ...message, text: 'Changed text' }, keys[0])).status, 409)
  const other = await post(message, keys[1])
  assert.equal(other.status, 202)
  assert.notEqual(other.data.webhookEventId, first.data.webhookEventId)
  const event = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: first.data.webhookEventId } })
  assert.equal(event.organizationId, org.id)
  assert.equal(event.source, 'GMAIL')
  assert.equal(event.externalObjectId, raw.id)
  assert.equal(event.apiKeyId, (await prisma.apiKey.findFirstOrThrow({ where: { organizationId: org.id, scope: 'WEBHOOK_ONLY' } })).id)
  assert.equal(await prisma.webhookEvent.count({ where: { organizationId: org.id, source: 'GMAIL' } }), 1)
  assert.equal(await prisma.workflowRun.count({ where: { webhookEventId: event.id, status: 'QUEUED' } }), 1)
  assert.equal(await prisma.aiInteraction.count({ where: { organizationId: org.id } }), 0)
  console.log('PASS Gmail v1 saved n8n mapping, scoped key auth, malformed/oversize/spoof/replay denial and one queued SQL run')
} finally {
  api.closeAllConnections()
  await new Promise<void>(resolve => api.close(() => resolve()))
  await prisma.$disconnect()
}
