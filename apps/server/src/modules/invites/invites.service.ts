import { Prisma, InviteStatus } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import { randomHex } from '../../utils/crypto'
import { buildPaginatedResult, getPaginationParams } from '../../utils/pagination'
import type { CreateInviteInput, ListInvitesQuery } from './invites.schema'
import type { PaginatedResult } from '../../types/pagination.types'

// ── Invite expires in 48 hours ────────────────────────────────────────────────

const INVITE_EXPIRES_MS = 48 * 60 * 60 * 1000

// ── Prisma select ─────────────────────────────────────────────────────────────

const inviteSelect = {
  id: true,
  createdAt: true,
  expiresAt: true,
  email: true,
  role: true,
  status: true,
  token: true,
  organizationId: true,
  organization: {
    select: { id: true, name: true, slug: true, logoUrl: true },
  },
} satisfies Prisma.InviteSelect

export type InvitePayload = Prisma.InviteGetPayload<{ select: typeof inviteSelect }>

// ── Service ───────────────────────────────────────────────────────────────────

/**
 * Create a new invite for a team member.
 * Admin only — enforced at router level.
 *
 * Returns the raw token so the caller can embed it in an email link.
 * e.g. https://app.sellora.com/accept-invite?token=<rawToken>
 */
async function createInvite(
  input: CreateInviteInput,
  organizationId: string
): Promise<{ invite: InvitePayload; inviteUrl: string }> {
  const { email, role } = input

  // Cannot invite someone who is already a member of this org
  const existingUser = await prisma.user.findFirst({
    where: { email, organizationId },
    select: { id: true },
  })
  if (existingUser) {
    throw ApiError.conflict(
      'A user with this email is already a member of your organization'
    )
  }

  // Cannot invite someone who has a user account in any org with this email
  // (email is globally unique in the users table)
  const userWithEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })
  if (userWithEmail) {
    throw ApiError.conflict(
      'This email is already associated with an account. Ask them to log in.'
    )
  }

  // Check no active (pending + not expired) invite already exists
  const existingInvite = await prisma.invite.findFirst({
    where: {
      email,
      organizationId,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  })
  if (existingInvite) {
    throw ApiError.conflict(
      'A pending invite already exists for this email. Revoke it first to resend.'
    )
  }

  // Generate a secure random token — not a JWT, just a random hex string.
  // It does not need to be a JWT because:
  // - it's stored in plain text in the DB (not hashed, unlike refresh tokens)
  // - it's short-lived (48h) and single-use
  // - the invite record itself holds all the data (email, role, org)
  const rawToken = randomHex(32)

  const invite = await prisma.invite.create({
    data: {
      email,
      role,
      token: rawToken,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + INVITE_EXPIRES_MS),
      organizationId,
    },
    select: inviteSelect,
  })

  // Build the invite URL the frontend will use
  const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:3000'
  const inviteUrl = `${clientUrl}/accept-invite?token=${rawToken}`

  // TODO: send email with inviteUrl when email service is set up
  // await emailService.sendInviteEmail({ to: email, inviteUrl, orgName: invite.organization.name })

  return { invite, inviteUrl }
}

/**
 * Validate an invite token — called by the frontend BEFORE showing
 * the accept-invite form. Returns safe public info (no sensitive fields).
 */
async function validateInviteToken(token: string): Promise<{
  email: string
  role: string
  organizationName: string
  organizationLogoUrl: string | null
  expiresAt: Date
}> {
  const invite = await prisma.invite.findUnique({
    where: { token },
    select: {
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      organization: {
        select: { name: true, logoUrl: true },
      },
    },
  })

  if (!invite) {
    throw ApiError.notFound('Invite not found or has already been used')
  }

  if (invite.status === 'ACCEPTED') {
    throw ApiError.conflict('This invite has already been accepted. Try logging in.')
  }

  if (invite.status === 'REVOKED') {
    throw ApiError.forbidden('This invite has been revoked by your admin.')
  }

  if (invite.status === 'EXPIRED' || invite.expiresAt < new Date()) {
    throw ApiError.badRequest('This invite has expired. Ask your admin to send a new one.')
  }

  return {
    email: invite.email,
    role: invite.role,
    organizationName: invite.organization.name,
    organizationLogoUrl: invite.organization.logoUrl,
    expiresAt: invite.expiresAt,
  }
}

/**
 * List all invites for an org with optional status filter and pagination.
 */
async function listInvites(
  query: ListInvitesQuery,
  organizationId: string
): Promise<PaginatedResult<InvitePayload>> {
  const { page, limit, skip } = getPaginationParams(query)

  const where: Prisma.InviteWhereInput = {
    organizationId,
    ...(query.status && { status: query.status as InviteStatus }),
  }

  const [items, total] = await prisma.$transaction([
    prisma.invite.findMany({
      where,
      select: inviteSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.invite.count({ where }),
  ])

  return buildPaginatedResult({ items, total, page, limit })
}

/**
 * Revoke a pending invite.
 * Only PENDING invites can be revoked — already accepted ones cannot.
 */
async function revokeInvite(
  inviteId: string,
  organizationId: string
): Promise<InvitePayload> {
  const invite = await prisma.invite.findFirst({
    where: { id: inviteId, organizationId },
    select: { id: true, status: true },
  })

  if (!invite) {
    throw ApiError.notFound('Invite not found')
  }

  if (invite.status === 'ACCEPTED') {
    throw ApiError.badRequest(
      'Cannot revoke an accepted invite. Deactivate the user instead.'
    )
  }

  if (invite.status === 'REVOKED') {
    throw ApiError.badRequest('Invite is already revoked')
  }

  const updated = await prisma.invite.update({
    where: { id: inviteId },
    data: { status: 'REVOKED' },
    select: inviteSelect,
  })

  return updated
}

/**
 * Resend an invite — revokes the old one and creates a fresh token.
 * Useful when the 48h window expires.
 */
async function resendInvite(
  inviteId: string,
  organizationId: string
): Promise<{ invite: InvitePayload; inviteUrl: string }> {
  const existing = await prisma.invite.findFirst({
    where: { id: inviteId, organizationId },
    select: { id: true, email: true, role: true, status: true },
  })

  if (!existing) {
    throw ApiError.notFound('Invite not found')
  }

  if (existing.status === 'ACCEPTED') {
    throw ApiError.badRequest('Cannot resend an already accepted invite.')
  }

  if (existing.status === 'REVOKED') {
    throw ApiError.badRequest('Cannot resend a revoked invite. Create a new one.')
  }

  // Revoke old + create fresh in one transaction
  const rawToken = randomHex(32)

  const [, newInvite] = await prisma.$transaction([
    prisma.invite.update({
      where: { id: inviteId },
      data: { status: 'REVOKED' },
    }),
    prisma.invite.create({
      data: {
        email: existing.email,
        role: existing.role,
        token: rawToken,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + INVITE_EXPIRES_MS),
        organizationId,
      },
      select: inviteSelect,
    }),
  ])

  const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:3000'
  const inviteUrl = `${clientUrl}/accept-invite?token=${rawToken}`

  // TODO: send email
  // await emailService.sendInviteEmail({ to: existing.email, inviteUrl, ... })

  return { invite: newInvite, inviteUrl }
}

export const invitesService = {
  createInvite,
  validateInviteToken,
  listInvites,
  revokeInvite,
  resendInvite,
}
