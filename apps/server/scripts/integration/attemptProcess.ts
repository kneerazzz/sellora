export {}
/** Child process used only by httpAccountLifecycle.ts on its disposable target. */
const target = process.env.SELLORA_DISPOSABLE_DATABASE_URL
if (!target || !/^postgresql:\/\/[^/]+\/(sellora_test_[^?]+)/.test(target)) throw new Error('Disposable target required')
const url = new URL(target)
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Local disposable target required')
process.env.DATABASE_URL = target
const { consumeAccountAttempt } = await import('../../src/middleware/accountAttemptLimit')
const { prisma } = await import('../../src/config/prisma')
try {
  const results = await Promise.all(Array.from({ length: 8 }, () => consumeAccountAttempt('fixture-parallel', 'fixture-address')))
  console.log(JSON.stringify({ admitted: results.filter(result => result.allowed).length }))
} finally { await prisma.$disconnect() }
