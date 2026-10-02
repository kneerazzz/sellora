import type { Prisma, User } from '@prisma/client'
import { ApiError } from '../../utils/apiError'
import type { JwtAccessPayload } from '../../types/auth.types'

export async function resolveCurrentUser(client: Pick<Prisma.TransactionClient, 'user'>, payload: JwtAccessPayload) {
  if (!payload || typeof payload !== 'object' || typeof payload.sub !== 'string' || typeof payload.organizationId !== 'string') {
    throw ApiError.unauthorized('Invalid access token')
  }
  const user = await client.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true, organizationId: true, firstName: true, lastName: true, isActive: true },
  })
  if (!user || !user.isActive || user.organizationId !== payload.organizationId) {
    throw ApiError.unauthorized('Account access has changed. Sign in again.')
  }
  return user
}

/** Must run inside one DB transaction, including the replacement token insert. */
export async function consumeRefreshToken<T>(
  tx: Prisma.TransactionClient,
  tokenHash: string,
  issueReplacement: (user: User, tx: Prisma.TransactionClient) => Promise<T>,
) {
  const now = new Date()
  const stored = await tx.refreshToken.findUnique({ where: { token: tokenHash }, include: { user: true } })
  if (!stored || stored.isRevoked || stored.expiresAt <= now) {
    throw ApiError.unauthorized('Refresh token is invalid, expired or already used. Sign in again.')
  }
  if (!stored.user.isActive) throw ApiError.forbidden('Account has been deactivated')
  // PostgreSQL rechecks this condition after concurrent writers release the row lock.
  const consumed = await tx.refreshToken.updateMany({
    where: { id: stored.id, isRevoked: false, expiresAt: { gt: now }, user: { isActive: true } },
    data: { isRevoked: true },
  })
  if (consumed.count !== 1) throw ApiError.unauthorized('Refresh token already used or account access changed. Sign in again.')
  // A failed insert rolls back consumption. Replay never revokes the winning session.
  return { user: stored.user, tokens: await issueReplacement(stored.user, tx) }
}
