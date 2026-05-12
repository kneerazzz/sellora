import { z } from 'zod'
import { LeadStatus, LeadSource } from '@prisma/client'

// ── Create ────────────────────────────────────────────────────────────────────

export const createLeadSchema = z.object({
  body: z.object({
    // Contact info
    firstName: z
      .string({ error: 'First name is required' })
      .min(1, 'First name is required')
      .max(50)
      .trim(),

    lastName: z
      .string({ error: 'Last name is required' })
      .min(1, 'Last name is required')
      .max(50)
      .trim(),

    email:       z.string().email('Invalid email').toLowerCase().trim().optional(),
    phone:       z.string().max(30).trim().optional(),
    linkedinUrl: z.string().url('Invalid LinkedIn URL').trim().optional(),
    avatarUrl:   z.string().url('Invalid URL').trim().optional(),

    // Company info
    company:     z.string().max(100).trim().optional(),
    jobTitle:    z.string().max(100).trim().optional(),
    department:  z.string().max(100).trim().optional(),
    companySize: z
      .enum(['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'])
      .optional(),
    industry:    z.string().max(100).trim().optional(),
    website:     z.string().url('Invalid website URL').trim().optional(),
    country:     z.string().max(100).trim().optional(),
    city:        z.string().max(100).trim().optional(),

    // CRM metadata
    status:      z.nativeEnum(LeadStatus).default('NEW').optional(),
    source:      z.nativeEnum(LeadSource).default('MANUAL').optional(),
    tags:        z.array(z.string().trim()).default([]).optional(),
    notes:       z.string().max(5000).trim().optional(),

    // Assignment
    assignedToId: z.string().cuid('Invalid user ID').optional(),

    // Custom fields — flexible JSON bag for per-org extensions
    customFields: z.record(z.string(), z.unknown()).optional(),

    // Follow-up scheduling
    nextFollowUpAt: z.string().datetime().optional(),
  }),
})

// ── Update ────────────────────────────────────────────────────────────────────

export const updateLeadSchema = z.object({
  params: z.object({
    id: z.string().cuid('Invalid lead ID'),
  }),
  body: z
    .object({
      firstName:    z.string().min(1).max(50).trim().optional(),
      lastName:     z.string().min(1).max(50).trim().optional(),
      email:        z.string().email('Invalid email').toLowerCase().trim().optional(),
      phone:        z.string().max(30).trim().optional(),
      linkedinUrl:  z.string().url('Invalid LinkedIn URL').trim().optional(),
      avatarUrl:    z.string().url('Invalid URL').trim().optional(),
      company:      z.string().max(100).trim().optional(),
      jobTitle:     z.string().max(100).trim().optional(),
      department:   z.string().max(100).trim().optional(),
      companySize:  z
        .enum(['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'])
        .optional(),
      industry:     z.string().max(100).trim().optional(),
      website:      z.string().url('Invalid website URL').trim().optional(),
      country:      z.string().max(100).trim().optional(),
      city:         z.string().max(100).trim().optional(),
      status:       z.nativeEnum(LeadStatus).optional(),
      source:       z.nativeEnum(LeadSource).optional(),
      tags:         z.array(z.string().trim()).optional(),
      notes:        z.string().max(5000).trim().optional(),
      assignedToId: z.string().cuid('Invalid user ID').nullable().optional(),
      customFields: z.record(z.string(), z.unknown()).optional(),
      nextFollowUpAt: z.string().datetime().nullable().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: 'At least one field must be provided for update',
    }),
})

// ── List / filter ─────────────────────────────────────────────────────────────

export const listLeadsSchema = z.object({
  query: z.object({
    page:         z.coerce.number().int().min(1).default(1).optional(),
    limit:        z.coerce.number().int().min(1).max(100).default(20).optional(),
    search:       z.string().trim().optional(),             // searches name, email, company
    status:       z.nativeEnum(LeadStatus).optional(),
    source:       z.nativeEnum(LeadSource).optional(),
    assignedToId: z.string().cuid().optional(),
    tags:         z                                         // ?tags=enterprise,hot
      .string()
      .transform((v) => v.split(',').map((t) => t.trim()))
      .optional(),
    sortBy: z
      .enum([
        'createdAt',
        'updatedAt',
        'firstName',
        'lastName',
        'company',
        'aiScore',
        'lastContactedAt',
        'nextFollowUpAt',
      ])
      .default('createdAt')
      .optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
  }),
})

// ── Single param ──────────────────────────────────────────────────────────────

export const leadParamSchema = z.object({
  params: z.object({
    id: z.string().cuid('Invalid lead ID'),
  }),
})

// ── Inferred types ────────────────────────────────────────────────────────────

export type CreateLeadInput = z.infer<typeof createLeadSchema>['body']
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>['body']
export type ListLeadsQuery  = z.infer<typeof listLeadsSchema>['query']