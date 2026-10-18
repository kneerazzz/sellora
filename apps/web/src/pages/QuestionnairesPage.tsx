import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { getErrorMessage } from '@/api/client'
import { cancelQuestionnaire, createQuestionnaire, exportQuestionnaire, getQuestionnaire,
  listQuestionnaires, retryQuestionnaireRow, type QuestionnaireJob } from '@/api/questionnaires'

export function QuestionnairesPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<Awaited<ReturnType<typeof listQuestionnaires>>>([])
  const [job, setJob] = useState<QuestionnaireJob | null>(null)
  const [format, setFormat] = useState<'TEXT' | 'CSV'>('CSV')
  const [content, setContent] = useState('')
  const [includeSources, setIncludeSources] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    try {
      if (id) setJob(await getQuestionnaire(id))
      else setJobs(await listQuestionnaires())
      setError('')
    } catch (cause) { setError(getErrorMessage(cause, 'Could not load questionnaires.')) }
  }
  useEffect(() => {
    void refresh()
    const interval = setInterval(() => { void refresh() }, 5000)
    return () => clearInterval(interval)
  }, [id])

  async function create() {
    if (!content.trim()) return
    setBusy(true); setError('')
    try { const next = await createQuestionnaire(format, content); navigate(`/questionnaires/${next.id}`) }
    catch (cause) { setError(getErrorMessage(cause, 'Could not import questionnaire.')) }
    finally { setBusy(false) }
  }
  async function retry(rowIndex: number) {
    if (!id) return
    setBusy(true); setError('')
    try { setJob(await retryQuestionnaireRow(id, rowIndex)) }
    catch (cause) { setError(getErrorMessage(cause, 'Could not retry row.')) }
    finally { setBusy(false) }
  }
  async function cancel() {
    if (!id || !window.confirm('Cancel unfinished rows? Completed answers stay saved.')) return
    setBusy(true); setError('')
    try { setJob(await cancelQuestionnaire(id)) }
    catch (cause) { setError(getErrorMessage(cause, 'Could not cancel questionnaire.')) }
    finally { setBusy(false) }
  }
  async function download() {
    if (!id) return
    setBusy(true); setError('')
    try {
      const blob = await exportQuestionnaire(id, includeSources)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = `questionnaire-${id}.csv`; anchor.click()
      URL.revokeObjectURL(url)
    } catch (cause) { setError(getErrorMessage(cause, 'Could not export questionnaire.')) }
    finally { setBusy(false) }
  }

  if (!id) return <div className="space-y-5">
    <h1 className="text-2xl font-semibold text-white">Questionnaires</h1>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <Card className="space-y-3"><h2 className="font-medium text-white">Import questions</h2>
      <p className="text-sm text-zinc-400">Development formats: one question per line, or CSV with rowId,question header. Up to 50 rows and 64 KiB. Every answer needs staff review.</p>
      <label className="block text-sm text-zinc-300">Format <select className="ml-2 rounded bg-zinc-800 p-2" value={format} onChange={event => setFormat(event.target.value as 'TEXT' | 'CSV')}><option value="CSV">CSV</option><option value="TEXT">Text</option></select></label>
      <label className="block text-sm text-zinc-300">File <input className="ml-2" type="file" accept=".csv,.txt,text/plain,text/csv" onChange={async event => { const file = event.target.files?.[0]; if (file) setContent(await file.text()) }} /></label>
      <label className="block text-sm text-zinc-300">Content<textarea className="mt-1 min-h-32 w-full rounded border border-white/10 bg-zinc-900 p-3 text-zinc-100" value={content} onChange={event => setContent(event.target.value)} /></label>
      <Button disabled={!content.trim() || busy} onClick={() => void create()}>Import</Button>
    </Card>
    <Card><h2 className="font-medium text-white">Recent jobs</h2><ul className="mt-3 space-y-2">{jobs.map(item => <li key={item.id}><Link className="text-zinc-200 underline" to={`/questionnaires/${item.id}`}>{new Date(item.createdAt).toLocaleString()} · {item.format} · {item.status} · {item._count.rows} rows</Link></li>)}</ul>{!jobs.length && <p className="mt-3 text-sm text-zinc-400">No questionnaires yet.</p>}</Card>
  </div>

  return <div className="space-y-5">
    <Link className="text-sm text-zinc-400 underline" to="/questionnaires">← Questionnaires</Link>
    <h1 className="text-2xl font-semibold text-white">Review questionnaire</h1>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {!job ? <p role="status" className="text-zinc-400">Loading questionnaire…</p> : <>
      <Card className="space-y-3"><p className="text-sm text-zinc-200">{job.status} · {job.rows.filter(row => !['QUEUED', 'PROCESSING'].includes(row.status)).length}/{job.rows.length} rows finished</p>
        <p className="text-xs text-zinc-400">Export includes every input row in order, including errors, refusals and unfinished rows. Check the exact draft revision before using an answer. Export does not send it.</p>
        <label className="block text-sm text-zinc-300"><input type="checkbox" checked={includeSources} onChange={event => setIncludeSources(event.target.checked)} /> Include current source IDs</label>
        <div className="flex gap-2"><Button disabled={busy} onClick={() => void download()}>Export CSV</Button>{job.status !== 'CANCELLED' && job.status !== 'COMPLETED' && <Button disabled={busy} onClick={() => void cancel()}>Cancel unfinished</Button>}</div>
      </Card>
      <ol className="space-y-3">{job.rows.map(row => <li key={row.rowIndex}><Card className="space-y-2"><p className="text-xs text-zinc-400">Row {row.rowIndex + 1} · ID {row.rowId} · {row.status} · {row.attemptCount} attempt{row.attemptCount === 1 ? '' : 's'}</p><p className="whitespace-pre-wrap break-words text-zinc-100">{row.question}</p>
        {row.draft ? <><p className="whitespace-pre-wrap break-words text-sm text-zinc-300">{row.draft.currentRevision?.content}</p><p className="text-xs text-zinc-400">Revision {row.draft.currentRevision?.revisionNumber} · {row.draft.reviewStatus}</p><Link className="text-sm text-zinc-200 underline" to={`/draft/${row.draftId}`}>Review exact draft and sources</Link></> : row.errorCode && <p className="text-sm text-amber-200">{row.errorCode}</p>}
        {row.status === 'ERROR' && row.attemptCount < 2 && job.status !== 'CANCELLED' && <Button disabled={busy} onClick={() => void retry(row.rowIndex)}>Retry row</Button>}
      </Card></li>)}</ol>
    </>}
  </div>
}
