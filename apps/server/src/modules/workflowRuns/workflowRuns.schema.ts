import { z } from 'zod'

export const listWorkflowRunsSchema = z.object({
  query: z.object({
    status: z
      .enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW'])
      .optional(),
    type: z
      .enum([
        'SALES_EVENT_EXTRACTION',
        'GROUNDED_TECHNICAL_ANSWER',
        'CRM_UPDATE_PREPARATION',
        'EMAIL_DRAFT',
        'CALL_SUMMARY',
        'CUSTOM',
      ])
      .optional(),
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
  }),
})

export const workflowRunIdParamSchema = z.object({
  params: z.object({
    id: z.string().cuid('Invalid workflow run ID'),
  }),
})

export const processQueuedWorkflowRunsSchema = z.object({
  body: z.object({
    limit: z.coerce.number().int().min(1).max(25).default(10).optional(),
  }),
})

export type ListWorkflowRunsQuery = z.infer<typeof listWorkflowRunsSchema>['query']
export type ProcessQueuedWorkflowRunsInput = z.infer<
  typeof processQueuedWorkflowRunsSchema
>['body']
