import { useCallback, useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { getErrorMessage } from '@/api/client'
import { actOnWorkflowRun, getWorkflowRun, listWorkflowRuns } from '@/api/workflowRuns'
import type { WorkflowRun } from '@/types/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'

const statusStyles: Record<string, string> = {
  QUEUED: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
  RUNNING: 'bg-blue-500/15 text-blue-300 ring-blue-500/30',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  FAILED: 'bg-red-500/15 text-red-300 ring-red-500/30',
  RETRY_WAIT: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  CANCELLED: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
}

const eventTypeLabel: Record<string, string> = {
  EMAIL_RECEIVED: 'Email',
  EMAIL_SENT: 'Email sent',
  CALL_TRANSCRIPT_RECEIVED: 'Transcript',
  MEETING_LOGGED: 'Meeting',
  CRM_RECORD_CREATED: 'CRM created',
  CRM_RECORD_UPDATED: 'CRM updated',
  CUSTOM: 'Custom',
}

export function WorkflowRunsPage() {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<WorkflowRun | null>(null)
  const [detailError, setDetailError] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionPending, setActionPending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { items } = await listWorkflowRuns({ limit: 50 })
      setRuns(items)
      setError('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [load])

  async function openDetail(id: string) {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetailError('')
    setDetail(null)
    try {
      setDetail(await getWorkflowRun(id))
    } catch (err) {
      setDetailError(getErrorMessage(err))
    } finally {
      setDetailLoading(false)
    }
  }

  async function runAction(action: 'retry' | 'cancel') {
    if (!detail) return
    setActionPending(true)
    setDetailError('')
    try {
      const updated = await actOnWorkflowRun(detail.id, action)
      setDetail(updated)
      await load()
    } catch (err) {
      await openDetail(detail.id)
      setDetailError(getErrorMessage(err))
    } finally {
      setActionPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Activity</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Processing activity for connected workflows.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <Card className="overflow-hidden !p-0"><div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 font-medium">Event</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Received</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading && runs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-zinc-500">
                  Loading workflow runs…
                </td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-zinc-500">
                  No workflow activity yet.
                </td>
              </tr>
            ) : (
              runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-white/5 transition-colors hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-4">
                    <p className="font-medium text-zinc-100">
                      {eventTypeLabel[run.webhookEvent?.eventType ?? ''] ??
                        run.webhookEvent?.eventType ??
                        run.type}
                    </p>
                    <p className="text-xs text-zinc-500">{run.webhookEvent?.source ?? '—'}</p>
                  </td>
                  <td className="px-5 py-4 text-zinc-400">{run.type.replace(/_/g, ' ')}</td>
                  <td className="px-5 py-4">
                    <Badge className={statusStyles[run.status] ?? statusStyles.QUEUED}>
                      {run.status}
                    </Badge>
                    {run.reviewStatus === 'REQUIRED' && <span className="ml-2 text-xs text-amber-300">Review required</span>}
                    {run.status === 'RETRY_WAIT' && run.nextAttemptAt &&
                      <p className="mt-1 text-xs text-amber-300">Retry after {formatDate(run.nextAttemptAt)}</p>}
                  </td>
                  <td className="px-5 py-4 text-zinc-400">
                    {formatDate(run.webhookEvent?.receivedAt ?? run.createdAt)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="secondary"
                      className="gap-1.5 !py-1.5 !text-xs"
                      onClick={() => openDetail(run.id)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Details
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table></div>
      </Card>

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Workflow activity"
        description="Processing, review and delivery remain separate. Retry and cancel never send externally."
        className="max-w-2xl">
        {detailLoading ? <p className="text-sm text-zinc-400">Loading run…</p> : detail ? (
          <div className="space-y-4 text-sm text-zinc-200">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={statusStyles[detail.status] ?? statusStyles.QUEUED}>{detail.status}</Badge>
              <span>Attempt {detail.attemptCount} of {detail.maxAttempts}</span>
              {detail.reviewStatus === 'REQUIRED' && <span className="text-amber-300">Review required</span>}
            </div>
            {detail.errorMessage && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-red-200">{detail.errorMessage}</p>}
            {detail.status === 'RETRY_WAIT' && detail.nextAttemptAt &&
              <p className="text-amber-300">Scheduled retry: {formatDate(detail.nextAttemptAt)}</p>}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => openDetail(detail.id)} disabled={actionPending}>Refresh</Button>
              {(['FAILED', 'RETRY_WAIT'].includes(detail.status) &&
                detail.reviewStatus !== 'APPROVED' && detail.deliveryStatus !== 'SENT') &&
                <Button variant="secondary" onClick={() => runAction('retry')} disabled={actionPending}>Retry</Button>}
              {['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(detail.status) &&
                <Button variant="secondary" onClick={() => runAction('cancel')} disabled={actionPending}>Cancel</Button>}
            </div>
            <div>
              <h3 className="mb-2 font-medium">Activity</h3>
              <ol className="max-h-40 space-y-2 overflow-y-auto text-xs text-zinc-400">
                {detail.activities?.map(item => <li key={item.id}>
                  {formatDate(item.createdAt)} · {item.kind} · attempt {item.attemptCount}
                  {item.message && <span className="block text-zinc-300">{item.message}</span>}
                </li>)}
              </ol>
            </div>
            <div>
              <h3 className="mb-2 font-medium">{detail.status === 'COMPLETED' ? 'Result' : 'Partial result (if available)'}</h3>
              <pre className="max-h-60 overflow-auto rounded-lg bg-zinc-950 p-3 text-xs">{JSON.stringify(detail.output ?? null, null, 2)}</pre>
            </div>
          </div>
        ) : null}
        {detailError && <p className="mt-3 text-sm text-red-300">{detailError}</p>}
      </Modal>

    </div>
  )
}
