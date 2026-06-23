import { Request, Response } from 'express'
import { invitesService } from './invites.service'
import { ApiResponse } from '../../utils/apiResponse'
import { asyncHandler } from '../../utils/asyncHandler'
import { ApiError } from '@/utils/apiError'
import type { CreateInviteInput, ListInvitesQuery } from './invites.schema'

/**
 * POST /api/v1/invites
 * Admin only — create a new invite and return the invite URL.
 * In production the URL is emailed to the invitee.
 * In development it is returned in the response for easy testing.
 */
const createInvite = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as CreateInviteInput

  // Security: Managers can only invite Members. Only Admins can invite Managers/Admins.
  if (req.user.role === 'MANAGER' && input.role !== 'REP') {
    throw ApiError.forbidden('Managers are only allowed to invite new Members.')
  }

  const { invite, inviteUrl } = await invitesService.createInvite(
    input,
    req.user.organizationId
  )

  res.status(201).json(
    ApiResponse.created('Invite created', {
      invite,
      // inviteUrl is returned so you can test without email in development.
      // Strip this from the response in production once email is wired up.
      inviteUrl,
    })
  )
})

/**
 * GET /api/v1/invites
 * Admin only — list all invites for the org.
 * Supports ?status=PENDING|ACCEPTED|EXPIRED|REVOKED
 */
const listInvites = asyncHandler(async (req: Request, res: Response) => {
  const result = await invitesService.listInvites(
    req.query as unknown as ListInvitesQuery,
    req.user.organizationId
  )

  res.status(200).json(
    ApiResponse.ok('Invites fetched', result.items, {
      page:        result.page,
      limit:       result.limit,
      total:       result.total,
      totalPages:  result.totalPages,
      hasNextPage: result.hasNextPage,
      hasPrevPage: result.hasPrevPage,
    })
  )
})

/**
 * GET /api/v1/invites/validate/:token
 * Public — no auth required.
 * Called by the frontend to show invite details before the user
 * fills in their name and password on the accept-invite page.
 *
 * Returns: email, role, organizationName, organizationLogoUrl, expiresAt
 * Does NOT return the full invite record.
 */
const validateInviteToken = asyncHandler(async (req: Request, res: Response) => {
  if(typeof req.params.token !== 'string') throw ApiError.badRequest('Invalid token format')
  const details = await invitesService.validateInviteToken(req.params.token)
  res.status(200).json(ApiResponse.ok('Invite is valid', details))
})

/**
 * DELETE /api/v1/invites/:id
 * Admin only — revoke a pending invite.
 */
const revokeInvite = asyncHandler(async (req: Request, res: Response) => {
  if(typeof req.params.id !== 'string') throw ApiError.badRequest('Invalid invite ID format')
  const invite = await invitesService.revokeInvite(
    req.params.id,
    req.user.organizationId
  )
  res.status(200).json(ApiResponse.ok('Invite revoked', invite))
})

/**
 * POST /api/v1/invites/:id/resend
 * Admin only — revoke old invite and issue a fresh one with a new token.
 */
const resendInvite = asyncHandler(async (req: Request, res: Response) => {
  if(typeof req.params.id !== 'string') throw ApiError.badRequest("Invalid invite ID format")
  const { invite, inviteUrl } = await invitesService.resendInvite(
    req.params.id,
    req.user.organizationId
  )
  res.status(200).json(ApiResponse.ok('Invite resent', { invite, inviteUrl }))
})

export const invitesController = {
  createInvite,
  listInvites,
  validateInviteToken,
  revokeInvite,
  resendInvite,
}