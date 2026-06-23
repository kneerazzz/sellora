import { useCallback, useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { getErrorMessage } from '@/api/client'
import { getWorkflowRun, listWorkflowRuns, previewCrmWriteback } from '@/api/workflowRuns'
import type { IntegrationProvider, WorkflowRun } from '@/types/api'
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
  NEEDS_REVIEW: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
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
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewJson, setPreviewJson] = useState<unknown>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [provider, setProvider] = useState<IntegrationProvider>('HUBSPOT')

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

  async function handlePreview(run: WorkflowRun) {
    setPreviewLoading(true)
    setPreviewOpen(true)
    setPreviewJson(null)
    try {
      if (run.status === 'COMPLETED') {
        const syncLog = await previewCrmWriteback({
          workflowRunId: run.id,
          provider,
        })
        setPreviewJson(syncLog.requestPayload)
      } else {
        const detail = await getWorkflowRun(run.id)
        setPreviewJson(detail.output ?? detail.input)
      }
    } catch (err) {
      setPreviewJson({ error: getErrorMessage(err) })
    } finally {
      setPreviewLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Workflow Runs</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Webhook events and AI extractions from emails and transcripts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">CRM provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as IntegrationProvider)}
            className="rounded-lg border border-white/10 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-200"
          >
            <option value="HUBSPOT">HubSpot</option>
            <option value="SALESFORCE">Salesforce</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <Card className="overflow-hidden !p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-5 py-3 font-medium">Event</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Confidence</th>
              <th className="px-5 py-3 font-medium">Received</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading && runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-zinc-500">
                  Loading workflow runs…
                </td>
              </tr>
            ) : runs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-zinc-500">
                  No workflow runs yet. Connect n8n webhooks to see events here.
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
                  </td>
                  <td className="px-5 py-4 text-zinc-400">{run.confidence ?? '—'}</td>
                  <td className="px-5 py-4 text-zinc-400">
                    {formatDate(run.webhookEvent?.receivedAt ?? run.createdAt)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Button
                      variant="secondary"
                      className="gap-1.5 !py-1.5 !text-xs"
                      onClick={() => handlePreview(run)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Preview CRM Writeback
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="CRM Writeback Preview"
        description="Extracted JSON payload ready for n8n writeback."
        className="max-w-2xl"
      >
        {previewLoading ? (
          <div className="flex justify-center py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-200" />
          </div>
        ) : (
          <pre className="max-h-[60vh] overflow-auto rounded-xl border border-white/10 bg-zinc-950/80 p-4 text-xs leading-relaxed text-emerald-100/90">
            {JSON.stringify(previewJson, null, 2)}
          </pre>
        )}
      </Modal>
    </div>
  )
}
