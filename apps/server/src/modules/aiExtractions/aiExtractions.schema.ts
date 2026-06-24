import { z } from 'zod'

export const confidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW'])

export const salesExtractionBodySchema = z.object({
  sourceType: z.enum(['EMAIL', 'CALL_TRANSCRIPT', 'CRM_NOTE', 'MANUAL']),
  content: z.string().trim().min(20, 'Content must be at least 20 characters'),
  subject: z.string().trim().max(300).optional(),
  participants: z.array(z.string().trim().min(1)).max(50).default([]).optional(),
  crmContext: z.record(z.string(), z.unknown()).optional(),
  leadId: z.string().cuid('Invalid lead ID').optional().or(z.literal('')).transform(val => val === '' ? undefined : val),
  dealId: z.string().cuid('Invalid deal ID').optional().or(z.literal('')).transform(val => val === '' ? undefined : val),
})

export const salesExtractionInputSchema = z.object({
  body: salesExtractionBodySchema,
})

export const salesExtractionOutputSchema = z.object({
  summary: z.string(),
  nextSteps: z.array(z.string()),
  buyerQuestions: z.array(z.string()),
  objections: z.array(z.string()),
  riskFlags: z.array(z.string()),
  crmUpdate: z.object({
    stage: z.string().nullable(),
    lastActivitySummary: z.string().nullable(),
    nextFollowUpAt: z.string().nullable(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).nullable(),
  }),
  confidence: confidenceSchema,
  confidenceReason: z.string(),
})

export type SalesExtractionInput = z.infer<typeof salesExtractionBodySchema>
export type SalesExtractionOutput = z.infer<typeof salesExtractionOutputSchema>
