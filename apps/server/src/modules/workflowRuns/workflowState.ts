import type { WorkflowRunStatus } from '@prisma/client'
import { ApiError } from '../../utils/apiError'

const transitions: Record<WorkflowRunStatus, readonly WorkflowRunStatus[]> = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'RETRY_WAIT', 'FAILED', 'CANCELLED'],
  RETRY_WAIT: ['RUNNING', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  NEEDS_REVIEW: [], // Historical rows migrate to COMPLETED + REQUIRED.
}

export function assertWorkflowTransition(from: WorkflowRunStatus, to: WorkflowRunStatus) {
  if (!transitions[from].includes(to)) {
    throw ApiError.conflict(`Workflow cannot transition from ${from} to ${to}`)
  }
}

export function assertWorkflowFinalization(input: {
  status: 'COMPLETED' | 'RETRY_WAIT' | 'FAILED'
  errorMessage?: string | null
  nextAttemptAt?: Date
}) {
  assertWorkflowTransition('RUNNING', input.status)
  if (input.status === 'COMPLETED' && (input.errorMessage || input.nextAttemptAt)) {
    throw ApiError.conflict('Completed workflow cannot retain an error or retry schedule')
  }
  if (input.status !== 'COMPLETED' && !input.errorMessage?.trim()) {
    throw ApiError.conflict('Failed workflow attempt requires an error')
  }
  if (input.status === 'RETRY_WAIT' && (!input.nextAttemptAt || !Number.isFinite(input.nextAttemptAt.getTime()))) {
    throw ApiError.conflict('Retryable workflow requires a valid retry time')
  }
  if (input.status !== 'RETRY_WAIT' && input.nextAttemptAt) {
    throw ApiError.conflict('Terminal workflow cannot retain a retry schedule')
  }
}

export const supportedWorkflowTypes = ['SALES_EVENT_EXTRACTION', 'GROUNDED_TECHNICAL_ANSWER'] as const

export function isSupportedWorkflowType(value: string): value is typeof supportedWorkflowTypes[number] {
  return supportedWorkflowTypes.some(type => type === value)
}
