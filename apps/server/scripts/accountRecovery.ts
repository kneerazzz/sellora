/** Explicit operator-only break-glass recovery. Never reads the ambient DB URL. */
import { open, unlink } from 'node:fs/promises'
const target = process.env.SELLORA_ACCOUNT_DATABASE_URL
const [organizationId, userId, outputFile, ...extra] = process.argv.slice(2)
if (!target || !organizationId || !userId || !outputFile || extra.length) {
  throw new Error('Requires SELLORA_ACCOUNT_DATABASE_URL and organizationId userId new-private-output-file')
}
const url = new URL(target)
if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error('PostgreSQL target required')
process.env.DATABASE_URL = target
const file = await open(outputFile, 'wx', 0o600)
let written = false
try {
  const { issueRecovery } = await import('../src/modules/auth/accountLifecycle')
  const { prisma } = await import('../src/config/prisma')
  try {
    const result = await issueRecovery(organizationId, userId)
    await file.writeFile(JSON.stringify(result))
    written = true
    console.log('Recovery capability saved in the selected private file; expires in 30 minutes.')
  } finally { await prisma.$disconnect() }
} finally {
  await file.close()
  if (!written) await unlink(outputFile)
}
