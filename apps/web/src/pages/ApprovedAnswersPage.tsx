import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { approveApprovedAnswer, getApprovedAnswer, listApprovedAnswerReviewQueue, listApprovedAnswers, reuseApprovedAnswer, type ApprovedAnswer } from '@/api/drafts'
import { getErrorMessage } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/context/AuthContext'

type QueueItem = { id: string; title: string; question: string; currentRevisionId: string | null; reviewStatus: string; reasons: Array<{ code: string }> }

export function ApprovedAnswersPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canApprove = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const [items, setItems] = useState<ApprovedAnswer[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  async function refresh(term = search) {
    setError('')
    try { const [answers, reviews] = await Promise.all([listApprovedAnswers(term), listApprovedAnswerReviewQueue()]); setItems(answers); setQueue(reviews) }
    catch (cause) { setError(getErrorMessage(cause, 'Could not load approved answers.')) }
  }
  useEffect(() => { void refresh('') }, [])
  async function submit(event: FormEvent) { event.preventDefault(); await refresh(search) }
  async function reuse(answer: ApprovedAnswer) {
    if (!answer.currentRevisionId) return
    setBusy(answer.id); setError(''); setStatus('')
    try { const draft = await reuseApprovedAnswer(answer.id, answer.currentRevisionId, answer.question); setStatus('Created an unapproved draft from the current answer.'); navigate(`/draft/${draft.id}`) }
    catch (cause) { setError(getErrorMessage(cause, 'This answer is no longer eligible to reuse. Refresh and review its status.')); await refresh() }
    finally { setBusy('') }
  }
  async function approve(item: QueueItem) {
    setBusy(item.id); setError(''); setStatus('')
    try { const answer = await getApprovedAnswer(item.id); const revision = answer.revisions?.find(value => value.id === answer.currentRevisionId); if (!revision || !revision.sources.length || revision.sources.some(source => source.availability !== 'CURRENT')) throw new Error('Sources are stale or unavailable. Update the source references before approval.'); await approveApprovedAnswer(item.id, revision.id); setStatus('Current library revision approved.'); await refresh() }
    catch (cause) { setError(getErrorMessage(cause, 'Could not approve this library revision.')); await refresh() }
    finally { setBusy('') }
  }
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold text-white">Approved answers</h1><p className="mt-1 text-sm text-zinc-400">Reuse always creates a new draft that needs its own review.</p><p className="mt-2 text-sm"><Link to="/draft" className="text-zinc-200 underline">Back to drafts</Link></p></header>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}{status && <p role="status" className="text-sm text-zinc-300">{status}</p>}
    <Card><form onSubmit={submit} className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="answer-search">Search approved answers</label><input id="answer-search" value={search} onChange={event => setSearch(event.target.value)} className="min-w-48 flex-1 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white" placeholder="Search question, answer or title"/><Button type="submit">Search</Button></form></Card>
    <section><h2 className="mb-3 text-lg font-medium text-white">Review queue ({queue.length})</h2>{queue.length ? <ul className="space-y-3">{queue.map(item => <li key={item.id}><Card><h3 className="font-medium text-zinc-100">{item.title}</h3><p className="mt-1 text-sm text-zinc-400">{item.question}</p><p className="mt-2 text-xs text-amber-200">{item.reasons.map(reason => reason.code.replaceAll('_', ' ').toLowerCase()).join(' · ')}</p><p className="mt-2 text-xs text-zinc-500">A revision with stale or unavailable sources cannot be approved. Update its references first.</p>{item.currentRevisionId && <Button className="mt-3" disabled={!canApprove} loading={busy === item.id} onClick={() => void approve(item)}>Review and approve current revision</Button>}</Card></li>)}</ul> : <p className="text-sm text-zinc-400">No answers need review.</p>}</section>
    <section><h2 className="mb-3 text-lg font-medium text-white">Library</h2>{items.length ? <ul className="space-y-3">{items.map(answer => <li key={answer.id}><Card><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium text-zinc-100">{answer.title}</h3><p className="mt-1 text-sm text-zinc-400">{answer.question}</p><p className="mt-2 text-xs text-zinc-500">{answer.eligibility === 'CURRENT' ? 'Current approval and sources' : answer.eligibility?.replaceAll('_', ' ').toLowerCase()}</p></div><Button disabled={!answer.currentRevisionId || answer.eligibility !== 'CURRENT'} loading={busy === answer.id} onClick={() => void reuse(answer)}>Reuse as new draft</Button></div>{answer.currentRevision?.content && <p className="mt-3 whitespace-pre-wrap break-words border-t border-white/10 pt-3 text-sm text-zinc-300">{answer.currentRevision.content}</p>}</Card></li>)}</ul> : <p className="text-sm text-zinc-400">No matching answers.</p>}</section>
  </div>
}
