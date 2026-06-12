import { z } from 'zod'

export const groundedAnswerSchema = z.object({
  body: z.object({
    question: z.string().min(3).max(4000).trim(),
    documentIds: z.array(z.string().cuid('Invalid document ID')).max(20).optional(),
    maxCitations: z.coerce.number().int().min(1).max(10).default(5).optional(),
  }),
})

export type GroundedAnswerInput = z.infer<typeof groundedAnswerSchema>['body']
