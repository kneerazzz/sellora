import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/apiError'
import {
  buildCrmWritebackPayload,
  normalizeSalesExtractionWorkflowOutput,
} from '../../utils/crmWritebackPayloads'
import type { CrmWritebackPreviewInput } from './crmWriteback.schema'

async function previewCrmWriteback(input: CrmWritebackPreviewInput, organizationId: string) {
  const workflowRun = await prisma.workflowRun.findFirst({
    where: {
      id: input.workflowRunId,
      organizationId,
    },
    include: {
      webhookEvent: {
        select: {
          id: true,
          externalObjectId: true,
          externalObjectType: true,
          integrationId: true,
        },
      },
    },
  })

  if (!workflowRun) {
    throw ApiError.notFound('Workflow run not found')
  }

  if (workflowRun.status !== 'COMPLETED' || !workflowRun.output) {
    throw ApiError.badRequest('Workflow run must be completed before preparing CRM writeback')
  }

  if (input.integrationId) {
    const integration = await prisma.integration.findFirst({
      where: {
        id: input.integrationId,
        organizationId,
        provider: input.provider,
      },
      select: { id: true },
    })

    if (!integration) {
      throw ApiError.notFound('Integration not found')
    }
  }

  const normalizedOutput = normalizeSalesExtractionWorkflowOutput(workflowRun.output)
  const requestPayload = buildCrmWritebackPayload(input.provider, normalizedOutput)
  const externalObjectType =
    input.externalObjectType ?? workflowRun.webhookEvent?.externalObjectType ?? 'LEAD'
  const externalObjectId = input.externalObjectId ?? workflowRun.webhookEvent?.externalObjectId

  return prisma.syncLog.create({
    data: {
      direction: 'OUTBOUND',
      status: 'PENDING',
      provider: input.provider,
      externalObjectType,
      externalObjectId,
      requestPayload: requestPayload as Prisma.InputJsonValue,
      organizationId,
      integrationId: input.integrationId ?? workflowRun.webhookEvent?.integrationId,
      webhookEventId: workflowRun.webhookEventId,
      workflowRunId: workflowRun.id,
    },
    select: {
      id: true,
      status: true,
      direction: true,
      provider: true,
      externalObjectType: true,
      externalObjectId: true,
      requestPayload: true,
      workflowRunId: true,
      webhookEventId: true,
      integrationId: true,
      createdAt: true,
    },
  })
}

export const crmWritebackService = {
  previewCrmWriteback,
}
