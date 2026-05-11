import { UserRole } from '@prisma/client'

export interface JwtAccessPayload {
  sub: string
  email: string
  role: UserRole
  organizationId: string
}

export interface JwtRefreshPayload {
  sub: string
  tokenId: string
}

export interface RegisterInput {
  firstName: string
  lastName: string
  email: string
  password: string
  organizationName: string
  organizationSlug: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface AuthUser {
  id: string
  email: string
  firstName: string
  lastName: string
  role: UserRole
  organizationId: string
}

export interface SessionInfo {
  id: string
  ipAddress: string
  userAgent: string
  createdAt: Date
  expiresAt: Date
}