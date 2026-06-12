import { z } from 'zod'
import { IntegrationProvider } from '@prisma/client'

export const crmWritebackPreviewSchema = z.object({
  body: z.object({
    workflowRunId: z.string().cuid('Invalid workflow run ID'),
    provider: z.nativeEnum(IntegrationProvider),
    externalObjectId: z.string().min(1).max(255).optional(),
    externalObjectType: z
      .enum(['CONTACT', 'COMPANY', 'LEAD', 'DEAL', 'OPPORTUNITY', 'TASK', 'ACTIVITY', 'OTHER'])
      .default('LEAD')
      .optional(),
    integrationId: z.string().cuid('Invalid integration ID').optional(),
  }),
})

export type CrmWritebackPreviewInput = z.infer<typeof crmWritebackPreviewSchema>['body']
