import { z } from 'zod'

export const webhookEventBodySchema = z.object({
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
    externalObjectId: z.string().trim().min(1).optional(),
    integrationId: z.string().cuid('Invalid integration ID').optional(),
    payload: z.record(z.string(), z.unknown()),
  }),
})

export type WebhookEventInput = z.infer<typeof webhookEventBodySchema>['body']
