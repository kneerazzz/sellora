import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createDraft, listDrafts, type Draft } from '@/api/drafts'
import { getErrorMessage } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

export function DraftsPage() {
  const [items, setItems] = useState<Draft[]>([])
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  async function refresh() {
    setLoading(true); setError('')
    try { setItems(await listDrafts()) } catch (cause) { setError(getErrorMessage(cause, 'Could not load drafts.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (question.trim().length < 3 || creating) return
    setCreating(true); setError('')
    try {
      const draft = await createDraft({ idempotencyKey: crypto.randomUUID(), question: question.trim() })
      navigate(`/draft/${draft.id}`)
    } catch (cause) { setError(getErrorMessage(cause, 'Could not create a saved draft.')) }
    finally { setCreating(false) }
  }
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold text-white">Drafts</h1><p className="mt-1 text-sm text-zinc-400">Saved replies stay available when you return. Nothing is sent automatically.</p><p className="mt-2 text-sm"><Link className="text-zinc-200 underline" to="/approved-answers">Approved answers library</Link></p></header>
    <Card><form onSubmit={submit} className="space-y-3">
      <label htmlFor="buyer-question" className="block text-sm font-medium text-zinc-200">Buyer question</label>
      <textarea id="buyer-question" rows={4} maxLength={4000} required value={question} onChange={event => setQuestion(event.target.value)} className="w-full rounded-lg border border-white/10 bg-zinc-900/80 px-3 py-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500/30" placeholder="What would you like to answer?" />
      <Button type="submit" loading={creating} disabled={question.trim().length < 3}>Create saved draft</Button>
    </form></Card>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <section aria-labelledby="draft-list-heading"><h2 id="draft-list-heading" className="mb-3 text-lg font-medium text-white">Recent drafts</h2>
      {loading ? <p role="status" className="text-sm text-zinc-400">Loading drafts…</p> : items.length ? <ul className="space-y-3">{items.map(item => <li key={item.id}><Card><Link className="block rounded focus:outline-none focus:ring-2 focus:ring-zinc-400" to={`/draft/${item.id}`}><span className="font-medium text-zinc-100">{item.title || item.question}</span><span className="mt-1 block text-sm text-zinc-400">{item.processingStatus} · {item.reviewStatus} · {new Date(item.updatedAt).toLocaleString()}</span>{item.currentRevision && <span className="mt-2 block line-clamp-2 whitespace-pre-wrap text-sm text-zinc-300">{item.currentRevision.content}</span>}</Link></Card></li>)}</ul> : <p className="text-sm text-zinc-400">No saved drafts yet. Ask a buyer question above to create one. <Link className="underline" to="/documents">Check Knowledge</Link> for sources first.</p>}
    </section>
  </div>
}
