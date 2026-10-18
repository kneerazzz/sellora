/** Restores only the wrapper's disposable database into a second owned container. */
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'

const sourceUrl = process.env.SELLORA_DISPOSABLE_DATABASE_URL
const sourceContainer = process.env.SELLORA_DISPOSABLE_CONTAINER
if (!sourceUrl || !sourceContainer || !/^sellora-check-[0-9a-f-]{36}$/.test(sourceContainer)) {
  throw new Error('Owned disposable source required')
}
const sourceAddress = new URL(sourceUrl)
if (!['127.0.0.1', 'localhost'].includes(sourceAddress.hostname) || sourceAddress.pathname !== '/sellora_test_migrations') {
  throw new Error('Owned localhost migration database required')
}
const targetContainer = `${sourceContainer}-restore`
const root = await mkdtemp(path.join(tmpdir(), 'sellora-restore-'))
let targetCreated = false
let targetDb: pg.Client | undefined
let api: ChildProcess | undefined
let disconnectSource: (() => Promise<void>) | undefined

function docker(args: string[], input?: Buffer, allowFailure = false) {
  const result = spawnSync('docker', args, { input, maxBuffer: 64 * 1024 * 1024, timeout: 180_000 })
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error('Disposable restore Docker step failed')
  return result
}

function hash(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex') }

try {
  const { prisma } = await import('../../src/config/prisma')
  disconnectSource = () => prisma.$disconnect()
  const marker = randomUUID()
  const passwordHash = await bcrypt.hash('RestoreFixturePassword1', 4)
  const organization = await prisma.organization.create({ data: { name: 'Restore fixture', slug: `restore-${marker}` } })
  const foreign = await prisma.organization.create({ data: { name: 'Foreign restore fixture', slug: `foreign-restore-${marker}` } })
  const [admin, manager, foreignAdmin] = await Promise.all([
    prisma.user.create({ data: { organizationId: organization.id, email: `restore-admin-${marker}@test.invalid`, passwordHash,
      firstName: 'Restore', lastName: 'Admin', role: 'ADMIN' } }),
    prisma.user.create({ data: { organizationId: organization.id, email: `restore-manager-${marker}@test.invalid`, passwordHash,
      firstName: 'Restore', lastName: 'Manager', role: 'MANAGER' } }),
    prisma.user.create({ data: { organizationId: foreign.id, email: `restore-foreign-${marker}@test.invalid`, passwordHash,
      firstName: 'Foreign', lastName: 'Admin', role: 'ADMIN' } }),
  ])
  const bytes = Buffer.from('Synthetic policy: refunds within thirty days.\n')
  const storagePath = path.join('uploads/documents', organization.id, 'policy.txt')
  const sourceFile = path.join(root, 'source', storagePath)
  const backupFile = path.join(root, 'backup', storagePath)
  const restoredFile = path.join(root, 'restored', storagePath)
  await mkdir(path.dirname(sourceFile), { recursive: true })
  await writeFile(sourceFile, bytes)
  const document = await prisma.document.create({ data: {
    organizationId: organization.id, uploadedById: admin.id, filename: 'policy.txt', displayName: 'Synthetic policy',
    mimeType: 'text/plain', sizeBytes: bytes.length, fileType: 'TXT', storagePath, status: 'COMPLETED',
    nextVersionNumber: 2, tags: [], totalChunks: 1,
  } })
  const version = await prisma.documentVersion.create({ data: {
    organizationId: organization.id, documentId: document.id, versionNumber: 1, filename: 'policy.txt',
    mimeType: 'text/plain', sizeBytes: bytes.length, fileType: 'TXT', storagePath,
    contentHash: hash(bytes), status: 'ACTIVE', totalChunks: 1, publishedAt: new Date(),
  } })
  const chunk = await prisma.documentChunk.create({ data: {
    documentId: document.id, versionId: version.id, chunkIndex: 0,
    text: bytes.toString('utf8'), tokenCount: 7, headingPath: [],
  } })
  await prisma.document.update({ where: { id: document.id }, data: { activeVersionId: version.id } })
  const draft = await prisma.draft.create({ data: {
    organizationId: organization.id, authorId: admin.id, question: 'What is the refund window?',
    requestedDocumentIds: [document.id], idempotencyKey: `restore-${marker}`, requestFingerprint: hash(bytes),
  } })
  const revision = await prisma.draftRevision.create({ data: {
    organizationId: organization.id, draftId: draft.id, authorId: admin.id, revisionNumber: 1,
    content: 'Refunds within thirty days.', origin: 'MANUAL',
  } })
  await prisma.draftRevisionSource.create({ data: {
    organizationId: organization.id, draftRevisionId: revision.id, documentId: document.id,
    versionId: version.id, chunkId: chunk.id, ordinal: 0,
  } })
  await prisma.draft.update({ where: { id: draft.id }, data: {
    currentRevisionId: revision.id, processingStatus: 'COMPLETED', reviewStatus: 'APPROVED',
  } })
  const approval = await prisma.draftApproval.create({ data: {
    organizationId: organization.id, draftId: draft.id, revisionId: revision.id,
    reviewerId: manager.id, decision: 'APPROVED',
  } })
  const ownedRawKey = `sk_sellora_restore_${marker}`
  const foreignRawKey = `sk_sellora_foreign_${marker}`
  const [ownedKey, foreignKey] = await Promise.all([
    prisma.apiKey.create({ data: { organizationId: organization.id, label: 'Disposable n8n key',
      keyHash: hash(Buffer.from(ownedRawKey)), keyPrefix: ownedRawKey.slice(0, 18), scope: 'WEBHOOK_ONLY' } }),
    prisma.apiKey.create({ data: { organizationId: foreign.id, label: 'Foreign disposable key',
      keyHash: hash(Buffer.from(foreignRawKey)), keyPrefix: foreignRawKey.slice(0, 18), scope: 'WEBHOOK_ONLY' } }),
  ])

  // No API or worker is started on the source while these two snapshots are taken.
  const cutAt = Date.now()
  const dump = docker(['exec', sourceContainer, 'pg_dump', '-Fc', '-U', 'sellora_test', '-d', 'sellora_test_migrations']).stdout
  await writeFile(path.join(root, 'backup.dump'), dump, { mode: 0o600 })
  await mkdir(path.dirname(backupFile), { recursive: true })
  await copyFile(sourceFile, backupFile)
  await prisma.activity.create({ data: { organizationId: organization.id, type: 'NOTE', title: 'Created after backup' } })

  docker(['run', '-d', '--name', targetContainer, '--label', 'sellora.disposable=true',
    '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_USER=sellora_test',
    '-e', 'POSTGRES_PASSWORD=disposable-local-only', '-e', 'POSTGRES_DB=sellora_test_restore',
    '-p', '127.0.0.1::5432', 'pgvector/pgvector:pg15'])
  targetCreated = true
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (docker(['exec', targetContainer, 'pg_isready', '-U', 'sellora_test', '-d', 'sellora_test_restore'], undefined, true).status === 0) {
      ready = true; break
    }
    await delay(500)
  }
  assert.ok(ready, 'Restored container must become ready')
  const port = docker(['port', targetContainer, '5432/tcp']).stdout.toString().trim()
  assert.match(port, /^127\.0\.0\.1:\d+$/)
  const targetUrl = `postgresql://sellora_test:disposable-local-only@${port}/sellora_test_restore`
  const restoreStarted = Date.now()
  docker(['exec', '-i', targetContainer, 'pg_restore', '--no-owner', '--no-acl', '--exit-on-error',
    '-U', 'sellora_test', '-d', 'sellora_test_restore'], dump)
  await mkdir(path.dirname(restoredFile), { recursive: true })
  await copyFile(backupFile, restoredFile)
  targetDb = new pg.Client({ connectionString: targetUrl })
  await targetDb.connect()
  const restored = await targetDb.query(`SELECT d.id AS document_id, d."activeVersionId" AS active_version,
    v."contentHash" AS content_hash, s."chunkId" AS chunk_id, r.id AS revision_id,
    a.id AS approval_id, a.decision, dr."currentRevisionId" AS current_revision
    FROM documents d JOIN document_versions v ON v.id = d."activeVersionId"
    JOIN draft_revision_sources s ON s."documentId" = d.id AND s."versionId" = v.id
    JOIN draft_revisions r ON r.id = s."draftRevisionId"
    JOIN drafts dr ON dr.id = r."draftId"
    JOIN draft_approvals a ON a."revisionId" = r.id
    WHERE d."organizationId" = $1`, [organization.id])
  assert.equal(restored.rowCount, 1)
  assert.deepEqual(restored.rows[0], { document_id: document.id, active_version: version.id,
    content_hash: hash(bytes), chunk_id: chunk.id, revision_id: revision.id,
    approval_id: approval.id, decision: 'APPROVED', current_revision: revision.id })
  assert.equal(hash(await readFile(restoredFile)), hash(bytes))
  assert.equal((await targetDb.query('SELECT count(*)::int AS count FROM activities WHERE title = $1',
    ['Created after backup'])).rows[0].count, 0)
  assert.equal((await targetDb.query('SELECT count(*)::int AS count FROM organizations WHERE id = $1',
    [foreign.id])).rows[0].count, 1)
  const recoveredAt = Date.now()

  const failedUpgrade = docker(['exec', '-i', targetContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'sellora_test', '-d', 'sellora_test_restore'], Buffer.from(
    `BEGIN; ALTER TABLE organizations ADD COLUMN "restoreProbe" TEXT; ` +
    `UPDATE organizations SET "restoreProbe" = 'attempted'; SELECT 1 / 0; COMMIT;`), true)
  assert.notEqual(failedUpgrade.status, 0)
  assert.equal((await targetDb.query(`SELECT count(*)::int AS count FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'restoreProbe'`)).rows[0].count, 0)
  assert.equal((await targetDb.query('SELECT count(*)::int AS count FROM draft_approvals WHERE id = $1',
    [approval.id])).rows[0].count, 1)
  docker(['exec', '-i', targetContainer, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', 'sellora_test', '-d', 'sellora_test_restore'], Buffer.from(
    `BEGIN; ALTER TABLE organizations ADD COLUMN "restoreProbe" TEXT; COMMIT;`))

  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  assert.ok(address && typeof address === 'object')
  const apiPort = address.port
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()))
  api = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', DATABASE_URL: targetUrl,
      PORT: String(apiPort), NODE_ENV: 'test', DOCUMENT_STORAGE_DIR: path.join(root, 'restored', 'uploads/documents') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let started = false
  api.stdout!.on('data', data => { if (String(data).includes('Sellora API running')) started = true })
  api.stderr!.resume()
  for (let attempt = 0; attempt < 100 && !started; attempt++) {
    if (api.exitCode !== null) break
    await delay(100)
  }
  assert.ok(started, 'Restored API must start')
  const token = (user: typeof admin) => jwt.sign({ sub: user.id, organizationId: user.organizationId,
    email: user.email, role: user.role }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '10m' })
  const route = `http://127.0.0.1:${apiPort}/api/v1/drafts/${draft.id}`
  const own = await fetch(route, { headers: { authorization: `Bearer ${token(admin)}` }, signal: AbortSignal.timeout(5_000) })
  assert.equal(own.status, 200)
  const ownBody = await own.json() as { data: { currentRevisionId: string; revisions: Array<{ sources: Array<{ availability: string }> }> } }
  assert.equal(ownBody.data.currentRevisionId, revision.id)
  assert.equal(ownBody.data.revisions[0]?.sources[0]?.availability, 'CURRENT')
  const denied = await fetch(route, { headers: { authorization: `Bearer ${token(foreignAdmin)}` }, signal: AbortSignal.timeout(5_000) })
  assert.equal(denied.status, 404)
  if (process.argv.includes('--offboarding')) {
    const base = `http://127.0.0.1:${apiPort}/api/v1`
    const request = (url: string, user: typeof admin, method = 'GET', body?: object) => fetch(`${base}${url}`, {
      method, headers: { authorization: `Bearer ${token(user)}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(5_000),
    })
    const exported = await request(`/drafts/${draft.id}/exports`, admin, 'POST', {
      revisionId: revision.id, includeSources: true, approvedOnly: true,
    })
    assert.equal(exported.status, 200)
    const exportBody = await exported.json() as { data: { content: string; revisionId: string; sourceStatus: string } }
    assert.equal(exportBody.data.content, 'Refunds within thirty days.')
    assert.equal(exportBody.data.revisionId, revision.id)
    assert.equal(exportBody.data.sourceStatus, 'CURRENT')
    assert.equal((await request(`/drafts/${draft.id}/exports`, foreignAdmin, 'POST', {
      revisionId: revision.id, includeSources: true, approvedOnly: true,
    })).status, 404)
    const preview = await request(`/documents/${document.id}/erasure-preview`, admin)
    assert.equal(preview.status, 200)
    const previewBody = await preview.json() as { data: { executionAvailable: boolean; totals: { originalFiles: number } } }
    assert.equal(previewBody.data.executionAvailable, false)
    assert.equal(previewBody.data.totals.originalFiles, 1)
    const keyRequest = (rawKey: string) => fetch(`${base}/workflow-runs`, {
      headers: { authorization: `Bearer ${rawKey}` }, signal: AbortSignal.timeout(5_000),
    })
    assert.equal((await keyRequest(ownedRawKey)).status, 200)
    assert.equal((await request(`/api-keys/${ownedKey.id}`, foreignAdmin, 'DELETE')).status, 404)
    assert.equal((await request(`/api-keys/${ownedKey.id}`, admin, 'DELETE')).status, 200)
    assert.equal((await keyRequest(ownedRawKey)).status, 401)
    assert.equal((await keyRequest(foreignRawKey)).status, 200)
    assert.equal((await targetDb.query('SELECT "isActive" FROM api_keys WHERE id = $1', [ownedKey.id])).rows[0].isActive, false)
    assert.equal((await targetDb.query('SELECT "isActive" FROM api_keys WHERE id = $1', [foreignKey.id])).rows[0].isActive, true)
    assert.equal((await request(`/documents/${document.id}`, admin, 'DELETE', {
      expectedActiveVersionId: version.id,
    })).status, 200)
    const after = await request(`/drafts/${draft.id}`, admin)
    assert.equal(after.status, 200)
    const afterBody = await after.json() as { data: { revisions: Array<{ sources: Array<{ availability: string }> }> } }
    assert.equal(afterBody.data.revisions[0]?.sources[0]?.availability, 'UNAVAILABLE')
    assert.equal(hash(await readFile(restoredFile)), hash(bytes))
    assert.equal(hash(await readFile(backupFile)), hash(bytes))
    assert.equal((await targetDb.query('SELECT count(*)::int AS count FROM organizations WHERE id = $1', [foreign.id])).rows[0].count, 1)
    console.log('PASS scoped export, foreign denial, key revocation and document tombstone; originals/backup remain, full erasure unavailable')
  }
  const elapsedMs = Date.now() - restoreStarted
  console.log(`PASS isolated DB/original restore, source hash, revision, approval, HTTP tenant boundary and failed-upgrade forward recovery; restore ${elapsedMs} ms, snapshot age ${recoveredAt - cutAt} ms`)
} finally {
  if (api && api.exitCode === null && api.signalCode === null) {
    const stopped = once(api, 'exit')
    api.kill('SIGTERM')
    await stopped
  }
  if (targetDb) await targetDb.end()
  await disconnectSource?.()
  if (targetCreated) docker(['rm', '-f', '-v', targetContainer])
  await rm(root, { recursive: true, force: true })
}
