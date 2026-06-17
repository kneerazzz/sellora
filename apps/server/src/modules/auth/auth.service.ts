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
const ACCESS_TOKEN_EXPIRES = env.JWT_ACCESS_EXPIRES_IN ?? '15m'
const REFRESH_TOKEN_EXPIRES_MS = env.JWT_REFRESH_EXPIRES_IN ?? "7d" // 7 days in ms

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
    throw ApiError.conflict(`Organization slug "${organizationSlug}" is already taken`)
  }

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    throw ApiError.conflict('An account with this email already exists')
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

  // Dummy compare — prevents timing-based user enumeration
  if (!user) {
    await bcrypt.compare(password, '$2a$12$placeholderfortimingattackprotection000')
    throw ApiError.unauthorized('Invalid email or password')
  }

  if (!user.isActive) {
    throw ApiError.forbidden('Your account has been deactivated. Contact your admin.')
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash)
  if (!isPasswordValid) {
    throw ApiError.unauthorized('Invalid email or password')
  }

  // Fire-and-forget lastLoginAt update
  prisma.user
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => {})

  const tokens = await issueTokens(user, meta)
  return { user: buildAuthUser(user), tokens }
}

/**
 * Rotate refresh token — validates old, revokes it, issues fresh pair.
 */
async function refresh(
  rawRefreshToken: string,
  meta: { ipAddress?: string; userAgent?: string }
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  const tokenHash = sha256Hex(rawRefreshToken)

  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: tokenHash },
    include: { user: true },
  })

  // Token reuse detected — revoke entire user's sessions
  if (storedToken?.isRevoked) {
    await prisma.refreshToken.updateMany({
      where: { userId: storedToken.userId },
      data: { isRevoked: true },
    })
    throw ApiError.unauthorized('Token reuse detected. All sessions have been revoked.')
  }

  if (!storedToken) {
    throw ApiError.unauthorized('Invalid refresh token')
  }

  if (storedToken.expiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token has expired')
  }

  if (!storedToken.user.isActive) {
    throw ApiError.forbidden('Account has been deactivated')
  }

  // Revoke old token
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { isRevoked: true },
  })

  const tokens = await issueTokens(storedToken.user, meta)
  return { user: buildAuthUser(storedToken.user), tokens }
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
  const session = await prisma.refreshToken.findUnique({
    where: { id: sessionId },
  })

  if (!session) {
    throw ApiError.notFound('Session not found')
  }

  // Critical: verify ownership — prevent one user revoking another's session
  if (session.userId !== userId) {
    throw ApiError.forbidden('You do not have permission to revoke this session')
  }

  if (session.isRevoked) {
    throw ApiError.badRequest('Session is already revoked')
  }

  await prisma.refreshToken.update({
    where: { id: sessionId },
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
async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string }
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  })
  if (!user) throw ApiError.notFound('User not found')

  const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash)
  if (!isValid) throw ApiError.badRequest('Current password is incorrect')

  if (input.currentPassword === input.newPassword) {
    throw ApiError.badRequest('New password must be different from current password')
  }

  const newHash = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS)

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    }),
    // Revoke all sessions — security best practice after password change
    prisma.refreshToken.updateMany({
      where: { userId },
      data: { isRevoked: true },
    }),
  ])
}

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
    await prisma.invite.update({
      where: { id: invite.id },
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

  // Transaction: create user + mark invite as accepted
  const user = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: invite.email,       // email comes from the invite, not user input
        passwordHash,
        role: invite.role,         // role was set by the admin when creating the invite
        organizationId: invite.organizationId,
      },
    })

    await tx.invite.update({
      where: { id: invite.id },
      data: { status: 'ACCEPTED' },
    })

    return user
  })

  const tokens = await issueTokens(user, meta)
  return { user: buildAuthUser(user), tokens }
}

// ── Internal: issue token pair ────────────────────────────────────────────────

async function issueTokens(
  user: { id: string; email: string; role: any; organizationId: string },
  meta: { ipAddress?: string; userAgent?: string }
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

  await prisma.refreshToken.create({
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
