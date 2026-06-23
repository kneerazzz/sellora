import { useEffect, useState } from 'react'
import { FileCheck, Workflow, ArrowUpRight } from 'lucide-react'
import { listDocuments } from '@/api/documents'
import { listWorkflowRuns } from '@/api/workflowRuns'
import { Card } from '@/components/ui/Card'
import { getErrorMessage } from '@/api/client'
import { isToday } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'

export function DashboardPage() {
  const { user } = useAuth()
  const [embeddedCount, setEmbeddedCount] = useState<number | null>(null)
  const [workflowsToday, setWorkflowsToday] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [docs, runs] = await Promise.all([
          listDocuments({ status: 'COMPLETED', limit: 1 }),
          listWorkflowRuns({ limit: 100 }),
        ])
        setEmbeddedCount(docs.meta?.total ?? docs.items.length)
        setWorkflowsToday(runs.items.filter((r) => isToday(r.createdAt)).length)
      } catch (err) {
        setError(getErrorMessage(err))
      }
    }
    load()
  }, [])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Good {getGreeting()}, {user?.firstName}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Overview of your knowledge base and AI workflow activity.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="group">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-400">Documents embedded</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {embeddedCount ?? '—'}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Ready for RAG queries</p>
            </div>
            <div className="rounded-lg bg-emerald-500/10 p-2.5 ring-1 ring-emerald-500/20 transition-transform duration-200 group-hover:scale-105">
              <FileCheck className="h-5 w-5 text-emerald-400" />
            </div>
          </div>
        </Card>

        <Card className="group">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-400">Workflows today</p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {workflowsToday ?? '—'}
              </p>
              <p className="mt-1 text-xs text-zinc-500">Emails, transcripts & events</p>
            </div>
            <div className="rounded-lg bg-violet-500/10 p-2.5 ring-1 ring-violet-500/20 transition-transform duration-200 group-hover:scale-105">
              <Workflow className="h-5 w-5 text-violet-400" />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Quick start</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Upload product docs, generate an API key, and connect n8n webhooks.
            </p>
          </div>
          <ArrowUpRight className="h-5 w-5 text-zinc-600" />
        </div>
        <ol className="mt-4 space-y-2 text-sm text-zinc-400">
          <li>1. Upload PDFs or DOCX files in Documents</li>
          <li>2. Create a webhook API key for n8n</li>
          <li>3. Monitor workflow runs and preview CRM writebacks</li>
        </ol>
      </Card>
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}
