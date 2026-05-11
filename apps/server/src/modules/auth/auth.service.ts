import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import type { RegisterInput, LoginInput } from './auth.schema'
import type {
  JwtAccessPayload,
  JwtRefreshPayload,
  AuthTokens,
  AuthUser,
} from '../../types/auth.types'

// ── Constants ─────────────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12
const ACCESS_TOKEN_EXPIRES = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m'
const REFRESH_TOKEN_EXPIRES = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d'
const REFRESH_TOKEN_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000 // 7 days in ms

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}


function generateAccessToken(payload: JwtAccessPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET as string, {
    expiresIn: ACCESS_TOKEN_EXPIRES,
  } as jwt.SignOptions)
}

function generateRefreshToken(payload: JwtRefreshPayload): string {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET as string, {
    expiresIn: REFRESH_TOKEN_EXPIRES,
  } as jwt.SignOptions)
}

function buildAuthUser(user: {
  id: string
  email: string
  firstName: string
  lastName: string
  role: any
  organizationId: string
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    organizationId: user.organizationId,
  }
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

  // Check slug uniqueness
  const existingOrg = await prisma.organization.findUnique({
    where: { slug: organizationSlug },
  })
  if (existingOrg) {
    throw ApiError.conflict(`Organization slug "${organizationSlug}" is already taken`)
  }

  // Check email uniqueness
  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    throw ApiError.conflict('An account with this email already exists')
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  // Transaction: create org + user atomically
  const { user, organization } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: organizationName,
        slug: organizationSlug,
      },
    })

    const user = await tx.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        role: 'ADMIN', // first user of an org is always admin
        organizationId: organization.id,
      },
    })

    return { user, organization }
  })

  // Issue tokens
  const tokens = await issueTokens(user, meta)

  return { user: buildAuthUser(user), tokens }
}

/**
 * Authenticate a user by email + password.
 * Returns user profile and fresh token pair.
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
      emailVerified: true,
    },
  })

  // Use constant-time comparison to prevent user enumeration
  if (!user) {
    await bcrypt.compare(password, '$2a$12$placeholderfortimingattack00000000000') // dummy compare
    throw ApiError.unauthorized('Invalid email or password')
  }

  if (!user.isActive) {
    throw ApiError.forbidden('Your account has been deactivated. Contact your admin.')
  }

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash)
  if (!isPasswordValid) {
    throw ApiError.unauthorized('Invalid email or password')
  }

  // Update lastLoginAt in background (non-blocking)
  prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  }).catch(() => {}) // fire and forget

  const tokens = await issueTokens(user, meta)

  return { user: buildAuthUser(user), tokens }
}

/**
 * Rotate refresh token.
 * Validates old token, revokes it, issues a fresh pair.
 */
async function refresh(
  rawRefreshToken: string,
  meta: { ipAddress?: string; userAgent?: string }
): Promise<{ user: AuthUser; tokens: AuthTokens }> {
  // Verify JWT signature first
  let payload: JwtRefreshPayload
  try {
    payload = jwt.verify(
      rawRefreshToken,
      process.env.JWT_REFRESH_SECRET as string
    ) as JwtRefreshPayload
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token')
  }

  // Check token exists in DB and is not revoked
  const tokenHash = hashToken(rawRefreshToken)
  const storedToken = await prisma.refreshToken.findUnique({
    where: { token: tokenHash },
    include: { user: true },
  })

  if (!storedToken || storedToken.isRevoked) {
    // Possible token reuse — revoke all tokens for this user (security measure)
    if (storedToken?.isRevoked) {
      await prisma.refreshToken.updateMany({
        where: { userId: payload.sub },
        data: { isRevoked: true },
      })
    }
    throw ApiError.unauthorized('Refresh token has been revoked or does not exist')
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

  // Issue fresh pair
  const tokens = await issueTokens(storedToken.user, meta)

  return { user: buildAuthUser(storedToken.user), tokens }
}

/**
 * Logout — revoke the provided refresh token.
 */
async function logout(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken)
  await prisma.refreshToken.updateMany({
    where: { token: tokenHash },
    data: { isRevoked: true },
  })
  // No error thrown if token doesn't exist — idempotent logout
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

// ── Internal: issue token pair ────────────────────────────────────────────────

async function issueTokens(
  user: { id: string; email: string; role: any; organizationId: string },
  meta: { ipAddress?: string; userAgent?: string }
): Promise<AuthTokens> {
  // Create refresh token record first to get its ID
  const tokenRecord = await prisma.refreshToken.create({
    data: {
      token: 'pending', // placeholder, updated below
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS),
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      userId: user.id,
    },
  })

  const accessPayload: JwtAccessPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  }

  const refreshPayload: JwtRefreshPayload = {
    sub: user.id,
    tokenId: tokenRecord.id,
  }

  const accessToken = generateAccessToken(accessPayload)
  const rawRefreshToken = generateRefreshToken(refreshPayload)
  const tokenHash = hashToken(rawRefreshToken)

  // Update the record with the real hash
  await prisma.refreshToken.update({
    where: { id: tokenRecord.id },
    data: { token: tokenHash },
  })

  return { accessToken, refreshToken: rawRefreshToken }
}

export const authService = {
  register,
  login,
  refresh,
  logout,
  getMe,
}