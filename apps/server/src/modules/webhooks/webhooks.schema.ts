import { z } from 'zod'

export const webhookEventBodySchema = z.object({
  query: z.object({
    process: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
  }),
  body: z.object({
    source: z
      .enum([
        'N8N',
        'SALESFORCE',
        'HUBSPOT',
        'GMAIL',
        'OUTLOOK',
        'SLACK',
        'RECALL_AI',
        'MANUAL',
        'CUSTOM',
      ])
      .default('N8N'),
    externalObjectType: z
      .enum([
        'CONTACT',
        'COMPANY',
        'LEAD',
        'DEAL',
        'OPPORTUNITY',
        'TASK',
        'ACTIVITY',
        'EMAIL',
        'THREAD',
        'MEETING',
        'TRANSCRIPT',
        'USER',
        'OTHER',
      ])
      .optional(),
    externalObjectId: z.string().trim().min(1).max(200).optional(),
    integrationId: z.string().cuid('Invalid integration ID').optional(),
    payload: z.record(z.string(), z.unknown()),
  }),
})

export type WebhookEventInput = z.infer<typeof webhookEventBodySchema>['body']
export type WebhookEventQuery = z.infer<typeof webhookEventBodySchema>['query']

export const gmailReceivedSchema = z.object({
  query: z.object({}).strict(),
  body: z.object({
    version: z.literal(1),
    messageId: z.string().regex(/^[A-Za-z0-9_-]{8,200}$/),
    threadId: z.string().regex(/^[A-Za-z0-9_-]{8,200}$/),
    from: z.string().trim().email().max(320),
    to: z.string().trim().email().max(320),
    subject: z.string().trim().min(1).max(500),
    text: z.string().trim().min(1).max(16000),
    messageDate: z.string().datetime(),
    sizeEstimate: z.number().int().min(1).max(131072),
  }).strict().refine(message => message.from.toLowerCase() !== message.to.toLowerCase(), {
    message: 'Self-addressed Gmail messages are excluded', path: ['from'],
  }),
})

export type GmailReceivedInput = z.infer<typeof gmailReceivedSchema>['body']
