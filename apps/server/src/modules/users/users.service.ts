import { changeStaffPassword } from '../auth/accountLifecycle'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { buildAuthUser } from '../../utils/authUser'
import { buildPaginatedResult, getPaginationParams } from '../../utils/pagination'
import type { PaginatedResult } from '../../types/pagination.types'
import type { AuthUser } from '../../types/auth.types'
import type { ListUsersQuery } from './users.schema'

// ── Constants ─────────────────────────────────────────────────────────────────  


const teamMemberSelect = {
  id: true,
  createdAt: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  avatarUrl: true,
  title: true,
  isActive: true,
  lastLoginAt: true,
  organizationId: true,
} satisfies Prisma.UserSelect

export type TeamMemberPayload = Prisma.UserGetPayload<{ select: typeof teamMemberSelect }>

/**
 * List active team members for the organization.
 */
async function listUsers(
  query: ListUsersQuery,
  organizationId: string
): Promise<PaginatedResult<TeamMemberPayload>> {
  const { page, limit, skip } = getPaginationParams(query)

  const where: Prisma.UserWhereInput = {
    organizationId,
    isActive: true,
    ...(query.search && {
      OR: [
        { email: { contains: query.search, mode: 'insensitive' } },
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
      ],
    }),
  }

  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: teamMemberSelect,
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      skip,
      take: limit,
    }),
    prisma.user.count({ where }),
  ])

  return buildPaginatedResult({ items, total, page, limit })
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

export const userService = {
  listUsers,
  getMe,
  changePassword,
  updateProfile,
}
