import { z } from 'zod'
import { env } from '../../config/env'

export const rfpExtractionBodySchema = z.object({
  content: z.string().trim().min(20, 'Content must be at least 20 characters').max(env.PROVIDER_INPUT_MAX_CHARS),
  documentIds: z.array(z.string().cuid()).optional(),
}).strict()

export const rfpAnswerRowsBodySchema = z.object({
  rows: z.array(z.object({
    rowId: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(4000),
  }).strict()).min(1).max(env.PROVIDER_QUESTION_MAX),
  documentIds: z.array(z.string().cuid()).optional(),
}).strict()

export const rfpExtractionInputSchema = z.object({
  body: z.union([rfpAnswerRowsBodySchema, rfpExtractionBodySchema]),
})

export const rfpExtractionOutputSchema = z.object({
  questions: z.array(z.string().trim().min(1).max(4000)).max(env.PROVIDER_QUESTION_MAX),
})

export type RfpExtractionInput = z.infer<typeof rfpExtractionBodySchema>
export type RfpRequestInput = z.infer<typeof rfpExtractionInputSchema>['body']
export type RfpExtractionOutput = z.infer<typeof rfpExtractionOutputSchema>
