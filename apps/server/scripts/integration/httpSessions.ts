/** Exercise actual refresh/cookie/access routes on the wrapper-owned disposable DB. */
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import jwt from 'jsonwebtoken'

const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target) throw new Error('Explicit disposable database required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.startsWith('/sellora_test_')) {
  throw new Error('Session harness requires a localhost sellora_test_* target')
}
Object.assign(process.env, {
  DATABASE_URL: target, NODE_ENV: 'test', EMBEDDING_PROVIDER: 'local',
  LOCAL_EMBEDDING_SERVICE_URL: 'http://127.0.0.1:1', GROQ_API_KEY: '', OPENAI_API_KEY: '',
})
const { prisma } = await import('../../src/config/prisma')
const { sha256Hex } = await import('../../src/utils/crypto')
let api: Server | undefined
try {
  assert.equal(await prisma.organization.count({ where: { slug: { startsWith: 'session-fixture-' } } }), 0)
  const { createApp } = await import('../../src/app')
  const [org, other] = await Promise.all(['a', 'b'].map(suffix => prisma.organization.create({
    data: { name: `Session fixture ${suffix}`, slug: `session-fixture-${suffix}` },
  })))
  const user = await prisma.user.create({ data: {
    organizationId: org!.id, email: 'session@test.invalid', passwordHash: 'unused',
    firstName: 'Session', lastName: 'Fixture', role: 'ADMIN',
  } })
  const sign = (expiresIn = '5m') => jwt.sign({
    sub: user.id, organizationId: org!.id, email: user.email, role: 'ADMIN',
  }, process.env.JWT_ACCESS_SECRET!, { expiresIn } as jwt.SignOptions)
  const access = sign()
  api = createServer(createApp())
  api.listen(0, '127.0.0.1')
  await once(api, 'listening')
  const address = api.address()
  assert.ok(address && typeof address === 'object')
  const base = `http://127.0.0.1:${address.port}/api/v1`
  const post = (route: string, raw: string, options: { cookie?: boolean; failInsert?: boolean } = {}) => fetch(`${base}/auth/${route}`, {
    method: 'POST', headers: {
      'content-type': 'application/json',
      ...(options.cookie && { cookie: `refreshToken=${raw}`, origin: 'http://localhost:3000' }),
      ...(options.failInsert && { 'user-agent': 'session-fixture-fail-insert' }),
    }, body: JSON.stringify(options.cookie ? {} : { refreshToken: raw }), signal: AbortSignal.timeout(30_000),
  })
  const me = (token: string) => fetch(`${base}/users/me`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  })
  const seed = (raw: string, expiresAt = new Date(Date.now() + 60_000)) => prisma.refreshToken.create({
    data: { token: sha256Hex(raw), userId: user.id, expiresAt },
  })
  const cookieToken = (response: Response) => {
    const cookies = response.headers.getSetCookie()
    assert.equal(cookies.length, 1)
    assert.ok(cookies[0]!.includes('HttpOnly'))
    assert.ok(cookies[0]!.includes('Path=/api/v1/auth'))
    assert.ok(cookies[0]!.includes('SameSite=Lax'))
    const match = cookies[0]!.match(/^refreshToken=([^;]+)/)
    assert.ok(match)
    return match[1]!
  }

  const original = await seed('session-race-original')
  const responses = await Promise.all([
    post('refresh', 'session-race-original', { cookie: true }),
    post('refresh', 'session-race-original', { cookie: true }),
  ])
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 401])
  const winner = responses.find(response => response.status === 200)!
  const loser = responses.find(response => response.status === 401)!
  assert.deepEqual(loser.headers.getSetCookie(), [], 'Loser cannot erase or overwrite the winning cookie')
  const winningRaw = cookieToken(winner)
  assert.notEqual(winningRaw, 'session-race-original')
  assert.equal((await prisma.refreshToken.findUniqueOrThrow({ where: { id: original.id } })).isRevoked, true)
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id, isRevoked: false } }), 1)
  const winnerData = await winner.json() as { data: { accessToken: string } }
  assert.equal((await me(winnerData.data.accessToken)).status, 200)
  assert.equal((await post('refresh', 'session-race-original')).status, 401)
  const successor = await post('refresh', winningRaw, { cookie: true })
  assert.equal(successor.status, 200, 'Replay of original does not revoke winner')
  cookieToken(successor)
  console.log('PASS HTTP refresh single winner, unique replacement, cookie/replay safety')

  const expired = await seed('session-expired', new Date(0))
  assert.equal((await post('refresh', 'session-expired')).status, 401)
  assert.equal((await prisma.refreshToken.findUniqueOrThrow({ where: { id: expired.id } })).isRevoked, false)
  assert.equal((await me(sign('-1s'))).status, 401)
  console.log('PASS HTTP access and stored refresh expiration')

  const rollback = await seed('session-rollback')
  await prisma.$executeRawUnsafe(`CREATE FUNCTION fail_session_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."userAgent" = 'session-fixture-fail-insert' THEN RAISE EXCEPTION 'session fixture insert failure'; END IF; RETURN NEW; END $$`)
  await prisma.$executeRawUnsafe('CREATE TRIGGER session_fixture_failure BEFORE INSERT ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION fail_session_fixture()')
  const countBefore = await prisma.refreshToken.count({ where: { userId: user.id } })
  const failed = await post('refresh', 'session-rollback', { failInsert: true })
  assert.equal(failed.status, 500)
  assert.deepEqual(failed.headers.getSetCookie(), [])
  assert.equal((await prisma.refreshToken.findUniqueOrThrow({ where: { id: rollback.id } })).isRevoked, false)
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), countBefore)
  await prisma.$executeRawUnsafe('DROP TRIGGER session_fixture_failure ON refresh_tokens')
  await prisma.$executeRawUnsafe('DROP FUNCTION fail_session_fixture()')
  assert.equal((await post('refresh', 'session-rollback')).status, 200)
  console.log('PASS real HTTP replacement insert failure rolls back consumption and allows retry')

  await prisma.user.update({ where: { id: user.id }, data: { role: 'REP' } })
  const profile = await me(access)
  assert.equal(profile.status, 200)
  assert.equal((await profile.json() as { data: { role: string } }).data.role, 'REP')
  await seed('session-current-role')
  const roleRefresh = await post('refresh', 'session-current-role')
  assert.equal(roleRefresh.status, 200)
  const roleData = await roleRefresh.json() as { data: { user: { role: string }; accessToken: string } }
  assert.equal(roleData.data.user.role, 'REP')
  assert.equal((jwt.verify(roleData.data.accessToken, process.env.JWT_ACCESS_SECRET!) as jwt.JwtPayload).role, 'REP')

  const inactive = await seed('session-inactive')
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })
  assert.equal((await me(access)).status, 401)
  assert.equal((await post('refresh', 'session-inactive')).status, 403)
  assert.equal((await prisma.refreshToken.findUniqueOrThrow({ where: { id: inactive.id } })).isRevoked, false)
  await prisma.user.update({ where: { id: user.id }, data: { isActive: true, organizationId: other!.id } })
  assert.equal((await me(access)).status, 401)
  // Refresh records bind to a user, not an old organization. This existing policy
  // requires offboarding to revoke sessions before changing membership (04C).
  const moved = await post('refresh', 'session-inactive')
  assert.equal(moved.status, 200)
  const movedData = await moved.json() as { data: { user: { organizationId: string }; accessToken: string } }
  assert.equal(movedData.data.user.organizationId, other!.id)
  assert.equal((await me(movedData.data.accessToken)).status, 200)
  console.log('PASS current role, inactive-user denial and moved-organization access/refresh policy')

  await seed('session-logout')
  assert.equal((await post('logout', 'session-logout')).status, 200)
  assert.equal((await post('refresh', 'session-logout')).status, 401)
  assert.equal((await me(movedData.data.accessToken)).status, 200, 'Logout does not revoke an already-issued JWT')
  await seed('session-deleted')
  await prisma.user.delete({ where: { id: user.id } })
  assert.equal((await me(movedData.data.accessToken)).status, 401)
  assert.equal((await post('refresh', 'session-deleted')).status, 401)
  assert.equal(await prisma.refreshToken.count({ where: { userId: user.id } }), 0)
  console.log('PASS logout revocation boundary, deleted-user rejection and cascade cleanup')
} finally {
  if (api) {
    api.closeAllConnections()
    await new Promise<void>(resolve => api!.close(() => resolve()))
  }
  await prisma.$disconnect()
}
