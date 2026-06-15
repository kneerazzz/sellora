import { z } from 'zod'

export const rfpExtractionBodySchema = z.object({
  content: z.string().trim().min(20, 'Content must be at least 20 characters'),
  documentIds: z.array(z.string().cuid()).optional(),
})

export const rfpExtractionInputSchema = z.object({
  body: rfpExtractionBodySchema,
})

export const rfpExtractionOutputSchema = z.object({
  questions: z.array(z.string()),
})

export type RfpExtractionInput = z.infer<typeof rfpExtractionBodySchema>
export type RfpExtractionOutput = z.infer<typeof rfpExtractionOutputSchema>
