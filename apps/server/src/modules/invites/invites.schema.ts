import { z } from 'zod'
import { UserRole } from '@prisma/client'

// ── Create invite ─────────────────────────────────────────────────────────────

export const createInviteSchema = z.object({
  body: z.object({
    email: z
      .string({ error: 'Email is required' })
      .email('Invalid email address')
      .toLowerCase()
      .trim(),

    role: z
      .enum(['MANAGER', 'REP'], {
        error: 'Role must be either MANAGER or REP',
      })
      .default('REP'),
    // Note: ADMIN role cannot be assigned via invite.
    // The only ADMIN is the org creator via register.
  }),
})

// ── List invites ──────────────────────────────────────────────────────────────

export const listInvitesSchema = z.object({
  query: z.object({
    status: z
      .enum(['PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'])
      .optional(),
    page:  z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  }),
})

// ── Single param (by id) ──────────────────────────────────────────────────────

export const inviteIdParamSchema = z.object({
  params: z.object({
    id: z.string().cuid('Invalid invite ID'),
  }),
})

// ── Token param (public — validate invite before accepting) ───────────────────

export const inviteTokenParamSchema = z.object({
  params: z.object({
    token: z.string().min(1, 'Token is required'),
  }),
})

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateInviteInput = z.infer<typeof createInviteSchema>['body']
export type ListInvitesQuery  = z.infer<typeof listInvitesSchema>['query']