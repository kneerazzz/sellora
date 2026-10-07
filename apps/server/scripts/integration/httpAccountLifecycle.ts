import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) throw new Error('Local test target required')
Object.assign(process.env, { DATABASE_URL: target, NODE_ENV: 'test', AUTH_ATTEMPT_MAX: '60',
  AUTH_ATTEMPT_WINDOW_SECONDS: '900', CLIENT_URL: 'http://localhost:3000', JWT_REFRESH_EXPIRES_IN: '30m',
  OPENAI_API_KEY: '', GROQ_API_KEY: '', LOCAL_EMBEDDING_SERVICE_URL: 'http://127.0.0.1:1' })
const { prisma } = await import('../../src/config/prisma')
const { sha256Hex } = await import('../../src/utils/crypto')
let api: Server | undefined
let count = 0
try {
  assert.equal(await prisma.organization.count({ where: { slug: { startsWith: 'lifecycle-fixture-' } } }), 0)
  const { createApp } = await import('../../src/app')
  const org = await prisma.organization.create({ data: { name: 'Lifecycle', slug: 'lifecycle-fixture-a' } })
  const foreign = await prisma.organization.create({ data: { name: 'Other', slug: 'lifecycle-fixture-b' } })
  const password = 'OriginalPassword1', newPassword = 'ReplacementPassword2'
  const passwordHash = await bcrypt.hash(password, 4)
  const user = (name: string, role: 'ADMIN' | 'MANAGER' | 'REP', organizationId = org.id) => prisma.user.create({ data: {
    organizationId, role, firstName: name, lastName: 'Fixture', email: `lifecycle-${name}@test.invalid`, passwordHash,
  } })
  const admin = await user('admin', 'ADMIN'), manager = await user('manager', 'MANAGER'), staff = await user('staff', 'REP'), other = await user('foreign', 'ADMIN', foreign.id)
  const sign = (u: typeof admin) => jwt.sign({ sub: u.id, email: u.email, organizationId: u.organizationId, role: u.role }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '5m' })
  const adminToken = sign(admin), staffToken = sign(staff)
  const machineKeys = await Promise.all((['READ_ONLY', 'FULL_ACCESS', 'WEBHOOK_ONLY'] as const).map(async scope => {
    const raw = `lifecycle-${scope.toLowerCase()}`
    await prisma.apiKey.create({ data: { organizationId: org.id, label: `Lifecycle ${scope}`, scope,
      keyHash: sha256Hex(raw), keyPrefix: 'lifecycle' } })
    return raw
  }))
  api = createServer(createApp()); api.listen(0, '127.0.0.1'); await once(api, 'listening')
  const address = api.address(); assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}/api/v1`
  async function request(method: string, route: string, body?: unknown, token = '', expected = 200, headers: Record<string, string> = {}) {
    count++
    const response = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
      ...(body !== undefined && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) })
    const data = await response.json()
    assert.equal(response.status, expected, `${method} ${route}: ${data.message}`)
    return { response, data: data.data, message: data.message }
  }
  // Fresh independent child processes contend on the same PostgreSQL bucket.
  const exec = promisify(execFile)
  const child = () => exec(process.execPath, ['--import', 'tsx', 'scripts/integration/attemptProcess.ts'], {
    env: { ...process.env, AUTH_ATTEMPT_MAX: '3' }, timeout: 30_000,
  })
  const results = await Promise.all([child(), child()])
  assert.equal(results.reduce((sum, result) => sum + JSON.parse(result.stdout.trim()).admitted, 0), 3)
  assert.equal(JSON.parse((await child()).stdout.trim()).admitted, 0, 'Restart cannot clear active attempts')
  await prisma.authAttemptBucket.updateMany({ data: { resetAt: new Date(0) } })
  assert.equal(JSON.parse((await child()).stdout.trim()).admitted, 3, 'Expired window admits a new bounded batch')
  const buckets = await prisma.authAttemptBucket.findMany()
  assert.ok(buckets.every(b => /^[a-f0-9]{64}$/.test(b.key)), 'Stored keys contain no IP/email/token')
  console.log('PASS shared atomic limiter across two processes, restart, expiry and hashed identity')

  const invite = async (suffix: string, expiresAt = new Date(Date.now() + 60_000)) => prisma.invite.create({ data: {
    organizationId: org.id, email: `lifecycle-invite-${suffix}@test.invalid`, role: 'REP', token: `lifecycle-invite-${suffix}`, expiresAt,
  } })
  const accept = (token: string) => ({ token, firstName: 'Invited', lastName: 'Staff', password })
  const raceInvite = await invite('race')
  const race = await Promise.all([0, 1].map(() => fetch(`${base}/auth/accept-invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(accept(raceInvite.token)) })))
  assert.deepEqual(race.map(r => r.status).sort(), [201, 409])
  await request('POST', '/auth/accept-invite', accept(raceInvite.token), '', 409)
  const expired = await invite('expired', new Date(0))
  await request('POST', '/auth/accept-invite', accept(expired.token), '', 400)
  const revoked = await invite('revoked')
  await request('DELETE', `/invites/${revoked.id}`, undefined, adminToken)
  await request('POST', '/auth/accept-invite', accept(revoked.token), '', 403)
  const resend = await invite('resend')
  const fresh = (await request('POST', `/invites/${resend.id}/resend`, {}, adminToken)).data
  await request('POST', '/auth/accept-invite', accept(resend.token), '', 403)
  await request('POST', '/auth/accept-invite', accept(fresh.invite.token), '', 201)
  const raceRevoke = await invite('race-revoke')
  const competing = await Promise.all([
    fetch(`${base}/auth/accept-invite`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(accept(raceRevoke.token)) }),
    fetch(`${base}/invites/${raceRevoke.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${adminToken}` } }),
  ])
  const terminal = await prisma.invite.findUniqueOrThrow({ where: { id: raceRevoke.id } })
  assert.ok(['ACCEPTED', 'REVOKED'].includes(terminal.status))
  assert.equal(await prisma.user.count({ where: { email: raceRevoke.email } }), terminal.status === 'ACCEPTED' ? 1 : 0)
  assert.ok(competing.some(r => r.ok)); assert.ok(competing.some(r => !r.ok))
  console.log('PASS single-use/expired/revoked/resend invite and accept-versus-revoke race')

  // New staff-only routes deny every inappropriate caller kind, including
  // valid machine scopes and a foreign administrator.
  for (const [token, expected] of [['', 401], [sign(manager), 403], [staffToken, 403],
    ['invalid-fixture-key', 401], ...machineKeys.map(key => [key, 401] as const)] as const) {
    await request('POST', `/users/${staff.id}/recovery`, {}, token, expected)
    await request('POST', `/users/${staff.id}/deactivate`, {}, token, expected)
  }
  await request('POST', `/users/${other.id}/recovery`, {}, adminToken, 404)
  await request('POST', `/users/${other.id}/deactivate`, {}, adminToken, 404)
  await request('POST', `/users/${admin.id}/deactivate`, {}, adminToken, 403)
  const issued = (await request('POST', `/users/${staff.id}/recovery`, {}, adminToken, 201)).data
  const storedRecovery = await prisma.passwordRecovery.findFirstOrThrow({ where: { userId: staff.id } })
  assert.notEqual(storedRecovery.tokenHash, issued.token); assert.equal(storedRecovery.tokenHash, sha256Hex(issued.token))
  const oldRefresh = 'lifecycle-before-reset'
  await prisma.refreshToken.create({ data: { userId: staff.id, token: sha256Hex(oldRefresh), expiresAt: new Date(Date.now() + 60_000) } })
  const resetRace = await Promise.all([0, 1].map(() => fetch(`${base}/auth/reset-password`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: issued.token, password: newPassword }) })))
  assert.deepEqual(resetRace.map(r => r.status).sort(), [200, 400])
  assert.equal(await prisma.refreshToken.count({ where: { userId: staff.id, isRevoked: false } }), 0)
  await request('POST', '/auth/reset-password', { token: issued.token, password: newPassword }, '', 400)
  await request('POST', '/auth/refresh', { refreshToken: oldRefresh }, '', 401)
  await request('POST', '/auth/login', { email: staff.email, password }, '', 401)
  const login = await request('POST', '/auth/login', { email: staff.email, password: newPassword })
  const cookie = login.response.headers.getSetCookie()[0]!
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\/api\/v1\/auth/); assert.match(cookie, /Max-Age=1800/)
  const rawCookie = cookie.split(';')[0]!
  const beforeCsrf = await prisma.refreshToken.count({ where: { userId: staff.id, isRevoked: false } })
  await request('POST', '/auth/refresh', {}, '', 403, { cookie: rawCookie })
  await request('POST', '/auth/refresh', {}, '', 403, { cookie: rawCookie, origin: 'https://hostile.invalid' })
  await request('POST', '/auth/refresh', {}, '', 403, { cookie: rawCookie, origin: 'null' })
  await request('POST', '/auth/refresh', {}, '', 403, { cookie: rawCookie, origin: 'http://localhost:3000', 'sec-fetch-site': 'cross-site' })
  assert.equal(await prisma.refreshToken.count({ where: { userId: staff.id, isRevoked: false } }), beforeCsrf)
  const refreshed = await request('POST', '/auth/refresh', {}, '', 200, { cookie: rawCookie, origin: 'http://localhost:3000' })
  assert.equal(refreshed.response.headers.get('access-control-allow-origin'), 'http://localhost:3000')
  assert.equal(refreshed.response.headers.get('access-control-allow-credentials'), 'true')
  const refreshedCookie = refreshed.response.headers.getSetCookie()[0]!
  const allowedPreflight = await fetch(`${base}/auth/refresh`, { method: 'OPTIONS', headers: {
    origin: 'http://localhost:3000', 'access-control-request-method': 'POST',
    'access-control-request-headers': 'content-type',
  } })
  assert.equal(allowedPreflight.status, 204)
  assert.equal(allowedPreflight.headers.get('access-control-allow-origin'), 'http://localhost:3000')
  assert.equal(allowedPreflight.headers.get('access-control-allow-credentials'), 'true')
  const deniedPreflight = await fetch(`${base}/auth/refresh`, { method: 'OPTIONS', headers: {
    origin: 'https://hostile.invalid', 'access-control-request-method': 'POST',
  } })
  assert.ok(deniedPreflight.status >= 200 && deniedPreflight.status < 300)
  assert.equal(deniedPreflight.headers.get('access-control-allow-origin'), null)
  assert.equal(deniedPreflight.headers.get('access-control-allow-credentials'), null)
  await request('POST', '/auth/login', { email: staff.email, password: newPassword }, '', 403, { origin: 'https://hostile.invalid' })
  const logout = await request('POST', '/auth/logout', {}, '', 200, {
    cookie: refreshedCookie.split(';')[0]!, origin: 'http://localhost:3000',
  })
  const cleared = logout.response.headers.getSetCookie()[0]!
  assert.match(cleared, /^refreshToken=;/); assert.match(cleared, /HttpOnly/)
  assert.match(cleared, /SameSite=Lax/); assert.match(cleared, /Path=\/api\/v1\/auth/)
  assert.match(cleared, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/)
  const superseded = (await request('POST', `/users/${staff.id}/recovery`, {}, adminToken, 201)).data
  const activeRecovery = (await request('POST', `/users/${staff.id}/recovery`, {}, adminToken, 201)).data
  await request('POST', '/auth/reset-password', { token: superseded.token, password }, '', 400)
  await prisma.passwordRecovery.updateMany({ where: { tokenHash: sha256Hex(activeRecovery.token) }, data: { expiresAt: new Date(0) } })
  await request('POST', '/auth/reset-password', { token: activeRecovery.token, password }, '', 400)
  console.log('PASS recovery permission/hash/single-use/reissue/expiry, refresh revocation and cookie/origin contract')

  const ownKey = await prisma.apiKey.create({ data: { organizationId: org.id, label: 'Offboard', keyPrefix: 'fixture', keyHash: sha256Hex('lifecycle-own-key') } })
  const otherKey = await prisma.apiKey.create({ data: { organizationId: foreign.id, label: 'Retain', keyPrefix: 'fixture', keyHash: sha256Hex('lifecycle-other-key') } })
  const outstanding = (await request('POST', `/users/${staff.id}/recovery`, {}, adminToken, 201)).data
  await request('POST', `/users/${staff.id}/deactivate`, {}, adminToken)
  await request('GET', '/users/me', undefined, staffToken, 401)
  const inactiveLogin = await request('POST', '/auth/login', { email: staff.email, password: newPassword }, '', 401)
  const missingLogin = await request('POST', '/auth/login', { email: 'absent@test.invalid', password }, '', 401)
  assert.equal(inactiveLogin.message, missingLogin.message)
  await request('POST', '/auth/reset-password', { token: outstanding.token, password }, '', 400)
  await request('POST', '/ai/grounded-answers', { question: 'refund policy' }, 'lifecycle-own-key', 401)
  assert.equal((await prisma.apiKey.findUniqueOrThrow({ where: { id: ownKey.id } })).isActive, false)
  assert.equal((await prisma.apiKey.findUniqueOrThrow({ where: { id: otherKey.id } })).isActive, true)
  assert.equal(await prisma.refreshToken.count({ where: { userId: staff.id, isRevoked: false } }), 0)
  console.log('PASS staff offboarding revokes sessions/recovery/org keys, preserves foreign org, generic login denial')

  // Malformed attempts count before validation; forwarding headers cannot evade
  // the socket-address bucket. Counter survives app recreation (shared DB).
  await prisma.authAttemptBucket.deleteMany()
  const attempts = await Promise.all(Array.from({ length: 65 }, (_, i) => fetch(`${base}/auth/reset-password`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${i}` }, body: '{}',
  })))
  assert.equal(attempts.filter(r => r.status === 422).length, 60)
  assert.equal(attempts.filter(r => r.status === 429).length, 5)
  assert.ok(Number(attempts.find(r => r.status === 429)!.headers.get('retry-after')) > 0)
  console.log(`PASS HTTP parallel attempt limit/Retry-After/forwarding spoof; ${count} additional lifecycle HTTP checks`)
} finally {
  if (api) { api.closeAllConnections(); await new Promise<void>(resolve => api!.close(() => resolve())) }
  await prisma.$disconnect()
}
