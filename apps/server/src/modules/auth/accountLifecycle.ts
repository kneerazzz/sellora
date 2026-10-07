import bcrypt from 'bcryptjs'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { randomHex, sha256Hex } from '../../utils/crypto'

// Administrator must verify the staff member through an established channel
// before delivering this short-lived capability. No email adapter is assumed.
export async function issueRecovery(organizationId: string, userId: string) {
  const rawToken = randomHex(32)
  return prisma.$transaction(async tx => {
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users
      WHERE id=${userId} AND "organizationId"=${organizationId} AND "isActive"=true FOR UPDATE`
    if (!users.length) throw ApiError.notFound('Active user not found')
    await tx.passwordRecovery.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } })
    const expiresAt = new Date(Date.now() + 30 * 60_000)
    await tx.passwordRecovery.create({ data: { tokenHash: sha256Hex(rawToken), userId, expiresAt } })
    return { token: rawToken, expiresAt }
  })
}

export async function resetPassword(token: string, password: string) {
  const tokenHash = sha256Hex(token)
  const recovery = await prisma.passwordRecovery.findUnique({ where: { tokenHash } })
  if (!recovery || recovery.usedAt || recovery.expiresAt <= new Date()) throw ApiError.badRequest('Recovery token is invalid or expired')
  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.$transaction(async tx => {
    // Serialize reset, reissue and offboarding for this user.
    const users = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE id=${recovery.userId} AND "isActive"=true FOR UPDATE`
    if (!users.length) throw ApiError.badRequest('Recovery token is invalid or expired')
    const claim = await tx.passwordRecovery.updateMany({ where: {
      id: recovery.id, usedAt: null, expiresAt: { gt: new Date() },
    }, data: { usedAt: new Date() } })
    if (claim.count !== 1) throw ApiError.badRequest('Recovery token is invalid or expired')
    await tx.user.update({ where: { id: recovery.userId }, data: { passwordHash } })
    await tx.refreshToken.updateMany({ where: { userId: recovery.userId }, data: { isRevoked: true } })
    await tx.passwordRecovery.updateMany({ where: { userId: recovery.userId, usedAt: null }, data: { usedAt: new Date() } })
  })
}

export async function deactivateUser(organizationId: string, userId: string, actorId: string) {
  if (userId === actorId) throw ApiError.forbidden('Self-deactivation is not supported')
  return prisma.$transaction(async tx => {
    // Admin-to-admin offboarding is a separate operator ownership transfer.
    const users = await tx.$queryRaw<Array<{ id: string; email: string }>>`SELECT id, email FROM users
      WHERE id=${userId} AND "organizationId"=${organizationId} AND role != 'ADMIN' FOR UPDATE`
    if (!users.length) throw ApiError.notFound('Staff user not found')
    await tx.user.update({ where: { id: userId, organizationId }, data: { isActive: false } })
    await tx.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } })
    await tx.passwordRecovery.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } })
    await tx.invite.updateMany({ where: { organizationId, email: users[0]!.email, status: 'PENDING' }, data: { status: 'REVOKED' } })
    // Keys have no user owner. All organization keys must be rotated when a
    // staff member may have held them; another organization's keys are untouched.
    const keys = await tx.apiKey.updateMany({ where: { organizationId, isActive: true }, data: { isActive: false } })
    return { userId, isActive: false, revokedApiKeys: keys.count }
  })
}

export async function changeStaffPassword(userId: string, input: { currentPassword: string; newPassword: string }) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !await bcrypt.compare(input.currentPassword, user.passwordHash)) throw ApiError.badRequest('Current password is incorrect')
  if (input.currentPassword === input.newPassword) throw ApiError.badRequest('New password must be different')
  const passwordHash = await bcrypt.hash(input.newPassword, 12)
  await prisma.$transaction(async tx => {
    const current = await tx.$queryRaw<Array<{ passwordHash: string; isActive: boolean }>>`
      SELECT "passwordHash", "isActive" FROM users WHERE id=${userId} FOR UPDATE`
    if (!current[0]?.isActive || current[0].passwordHash !== user.passwordHash) throw ApiError.conflict('Account changed; sign in again')
    await tx.user.update({ where: { id: userId }, data: { passwordHash } })
    await tx.refreshToken.updateMany({ where: { userId }, data: { isRevoked: true } })
    await tx.passwordRecovery.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } })
  })
}
