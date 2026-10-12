import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertWorkflowFinalization, assertWorkflowTransition, isSupportedWorkflowType } from './workflowState'

test('processing transitions distinguish retry, terminal, review and unsupported types', () => {
  for (const [from, to] of [
    ['QUEUED', 'RUNNING'], ['RUNNING', 'RETRY_WAIT'], ['RETRY_WAIT', 'RUNNING'],
    ['RUNNING', 'COMPLETED'], ['RUNNING', 'FAILED'], ['QUEUED', 'CANCELLED'],
  ] as const) assert.doesNotThrow(() => assertWorkflowTransition(from, to))
  for (const [from, to] of [
    ['COMPLETED', 'RUNNING'], ['FAILED', 'RUNNING'], ['CANCELLED', 'RUNNING'],
    ['NEEDS_REVIEW', 'RUNNING'], ['QUEUED', 'COMPLETED'],
  ] as const) assert.throws(() => assertWorkflowTransition(from, to), (error: any) => error.statusCode === 409)
  assert.equal(isSupportedWorkflowType('SALES_EVENT_EXTRACTION'), true)
  assert.equal(isSupportedWorkflowType('GROUNDED_TECHNICAL_ANSWER'), true)
  assert.equal(isSupportedWorkflowType('CRM_UPDATE_PREPARATION'), false)
})

test('finalization requires error and retry-time semantics', () => {
  assert.doesNotThrow(() => assertWorkflowFinalization({ status: 'COMPLETED', errorMessage: null }))
  assert.doesNotThrow(() => assertWorkflowFinalization({ status: 'RETRY_WAIT', errorMessage: 'temporary', nextAttemptAt: new Date() }))
  for (const input of [
    { status: 'FAILED' as const },
    { status: 'RETRY_WAIT' as const, errorMessage: 'temporary' },
    { status: 'COMPLETED' as const, errorMessage: 'stale error' },
  ]) assert.throws(() => assertWorkflowFinalization(input), (error: any) => error.statusCode === 409)
})
