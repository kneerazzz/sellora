import { changeStaffPassword } from '../auth/accountLifecycle'
import type { Prisma } from '@prisma/client'
import { consumeRefreshToken } from './sessionPolicy'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { buildAuthUser } from '../../utils/authUser'
import { randomHex, sha256Hex } from '../../utils/crypto'
import type { RegisterInput, LoginInput } from './auth.schema'
import type {
  JwtAccessPayload,
  AuthTokens,
  AuthUser,
  SessionInfo,
} from '../../types/auth.types'
import { env } from '@/config/env'

// ── Constants ─────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('non-account-timing-placeholder', BCRYPT_ROUNDS)
const ACCESS_TOKEN_EXPIRES = env.JWT_ACCESS_EXPIRES_IN ?? '15m'

function parseExpiresInToMs(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)([dhms])$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000 // default 7 days
  const val = parseInt(match[1], 10)
  const unit = match[2]
  switch (unit) {
    case 'd': return val * 24 * 60 * 60 * 1000
    case 'h': return val * 60 * 60 * 1000
    case 'm': return val * 60 * 1000
    case 's': return val * 1000
    default: return 7 * 24 * 60 * 60 * 1000
  }
}

const REFRESH_TOKEN_EXPIRES_MS = parseExpiresInToMs(env.JWT_REFRESH_EXPIRES_IN ?? '7d')

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateAccessToken(payload: JwtAccessPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET as string, {
    expiresIn: ACCESS_TOKEN_EXPIRES,
  } as jwt.SignOptions)
}

// ── Service methods ───────────────────────────────────────────────────────────

/**
 * Register a new organization and its first admin user.
 * Creates both in a single transaction.
 */
async function register(
  input: RegisterInput,
  meta: { ipAddress?: string; userAgent?: string }
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const { firstName, lastName, email, password, organizationName, organizationSlug } = input

  const existingOrg = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
  })
  if (existingOrg) {
    throw ApiError.conflict('Registration is unavailable for these details')
  }

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    throw ApiError.conflict('Registration is unavailable for these details')
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  const { user } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: organizationName, slug: organizationSlug },
    })
    const user = await tx.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        role: 'ADMIN',
        organizationId: organization.id,
      },
    })
    return { user, organization }
  })

  const tokens = await issueTokens(user, meta)
  return { user: buildAuthUser(user), tokens }
}

/**
 * Authenticate a user by email + password.
 */
async function login(
  input: LoginInput,
  meta: { ipAddress?: string; userAgent?: string }
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const { email, password } = input

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      passwordHash: true,
      role: true,
      organizationId: true,
      isActive: true,
    },
  })

  const isPasswordValid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
  if (!user || !user.isActive || !isPasswordValid) {
    throw ApiError.unauthorized('Invalid email or password')
  }

  return prisma.$transaction(async tx => {
    const current = await tx.$queryRaw<Array<{ passwordHash: string; isActive: boolean; organizationId: string }>>`
      SELECT "passwordHash", "isActive", "organizationId" FROM users WHERE id=${user.id} FOR UPDATE`
    if (!current[0]?.isActive || current[0].passwordHash !== user.passwordHash || current[0].organizationId !== user.organizationId) {
      throw ApiError.unauthorized('Invalid email or password')
    }
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    const tokens = await issueTokens(user, meta, tx)
    return { user: buildAuthUser(user), tokens }
  })
}

/**
 * Rotate refresh token — validates old, revokes it, issues fresh pair.
 */
async function refresh(
  rawRefreshToken: string,
  meta: { ipAddress?: string; userAgent?: string }
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const tokenHash = sha256Hex(rawRefreshToken)

  const result = await prisma.$transaction((tx) => consumeRefreshToken(tx, tokenHash,
    (user, transaction) => issueTokens(user, meta, transaction)))
  return { user: buildAuthUser(result.user), tokens: result.tokens }
}

/**
 * Logout — revoke the current refresh token (current device only).
 */
async function logout(rawRefreshToken: string): Promise<void> {
  const tokenHash = sha256Hex(rawRefreshToken)
  await prisma.refreshToken.updateMany({
    where: { token: tokenHash },
    data: { isRevoked: true },
  })
}

/**
 * Logout all — revoke every active session for this user.
 */
async function logoutAll(userId: string): Promise<{ revokedCount: number }> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true },
  })
  return { revokedCount: result.count }
}

/**
 * Get all active sessions for the current user.
 */
async function getSessions(userId: string): Promise<SessionInfo[]> {
  const sessions = await prisma.refreshToken.findMany({
    where: {
      userId,
      isRevoked: false,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  return sessions.map((s) => ({
    id: s.id,
    ipAddress: s.ipAddress ?? 'Unknown',
    userAgent: s.userAgent ?? 'Unknown',
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
  }))
}

/**
 * Revoke a specific session by ID.
 * Ensures the session belongs to the requesting user (prevents IDOR).
 */
async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const session = await prisma.refreshToken.findFirst({
    where: { id: sessionId, userId },
  })

  if (!session) {
    throw ApiError.notFound('Session not found')
  }

  if (session.isRevoked) {
    throw ApiError.badRequest('Session is already revoked')
  }

  await prisma.refreshToken.update({
    where: { id: sessionId, userId },
    data: { isRevoked: true },
  })
}

/**
 * Get the currently authenticated user's full profile.
 */
async function getMe(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      organizationId: true,
      avatarUrl: true,
      phone: true,
      title: true,
      timezone: true,
      isActive: true,
      emailVerified: true,
      createdAt: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          plan: true,
          logoUrl: true,
        },
      },
    },
  })

  if (!user) throw ApiError.notFound('User not found')
  return user as unknown as AuthUser
}

/**
 * Change password — verifies current password, hashes new one,
 * revokes all sessions to force re-login on all devices.
 */
const changePassword = changeStaffPassword

/**
 * Update profile fields.
 */
async function updateProfile(
  userId: string,
  input: {
    firstName?: string
    lastName?: string
    phone?: string
    title?: string
    timezone?: string
    avatarUrl?: string
  }
): Promise<AuthUser> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: input,
  })
  return buildAuthUser(user)
}

/**
 * Accept an invite — creates the user account and links to the org.
 * Validates: token exists, not expired, not already accepted.
 */
async function acceptInvite(
  input: {
    token: string
    firstName: string
    lastName: string
    password: string
  },
  meta: { ipAddress?: string; userAgent?: string }
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const invite = await prisma.invite.findUnique({
    where: { token: input.token },
    include: { organization: true },
  })

  if (!invite) {
    throw ApiError.notFound('Invite not found or already used')
  }

  if (invite.status === 'ACCEPTED') {
    throw ApiError.conflict('This invite has already been accepted')
  }

  if (invite.status === 'REVOKED') {
    throw ApiError.forbidden('This invite has been revoked')
  }

  if (invite.expiresAt < new Date() || invite.status === 'EXPIRED') {
    // Mark as expired if not already
    await prisma.invite.updateMany({
      where: { id: invite.id, status: 'PENDING', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    })
    throw ApiError.badRequest('This invite has expired. Request a new one from your admin.')
  }

  // Check if a user with this email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email: invite.email },
  })
  if (existingUser) {
    throw ApiError.conflict(
      'An account with this email already exists. Try logging in instead.'
    )
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)

  // Claim and account/session creation share one transaction. Revoke/resend
  // use the same conditional row update, so an invalidated invite cannot win.
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.invite.updateMany({
      where: { id: invite.id, status: 'PENDING', expiresAt: { gt: new Date() } },
      data: { status: 'ACCEPTED' },
    })
    if (claimed.count !== 1) throw ApiError.conflict('Invite is no longer available')
    const user = await tx.user.create({ data: {
      firstName: input.firstName, lastName: input.lastName, email: invite.email,
      passwordHash, role: invite.role, organizationId: invite.organizationId,
    } })
    const tokens = await issueTokens(user, meta, tx)
    return { user: buildAuthUser(user), tokens }
  })
}

// ── Internal: issue token pair ────────────────────────────────────────────────

async function issueTokens(
  user: { id: string; email: string; role: any; organizationId: string },
  meta: { ipAddress?: string; userAgent?: string },
  client: Pick<Prisma.TransactionClient, 'refreshToken'> = prisma
): Promise<AuthTokens> {
  const rawRefreshToken = randomHex(64)
  const tokenHash = sha256Hex(rawRefreshToken)

  const accessPayload: JwtAccessPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  }

  const accessToken = generateAccessToken(accessPayload)

  await client.refreshToken.create({
    data: {
      token: tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      userId: user.id,
    },
  })

  return { accessToken, refreshToken: rawRefreshToken }
}

export const authService = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getSessions,
  revokeSession,
  getMe,
  changePassword,
  updateProfile,
  acceptInvite,
}
