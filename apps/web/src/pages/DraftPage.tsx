import { useEffect, useState } from 'react'
import axios from 'axios'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { approveDraftRevision, confirmDraftRevisionCopied, getDraft, requestDraftRevisionExport, saveDraftRevision, saveDraftToLibrary, type Draft, type DraftSource } from '@/api/drafts'
import { inspectDocumentVersion } from '@/api/documents'
import { getErrorMessage } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

const area = 'w-full rounded-lg border border-white/10 bg-zinc-900/80 px-3 py-3 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-500/30'
type Context = { key: string; source: DraftSource; passages: Array<{ id: string; chunkIndex: number; text: string; pageNumber: number | null; headingPath: string[]; sectionTitle: string | null }>; truncated: boolean }

export function DraftPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [text, setText] = useState('')
  const [savedText, setSavedText] = useState('')
  const [contexts, setContexts] = useState<Context[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [saveConflict, setSaveConflict] = useState(false)
  const dirty = text !== savedText
  const current = draft?.revisions?.find(revision => revision.id === draft.currentRevisionId) ?? null
  const currentApproved = !!current && draft?.reviewStatus === 'APPROVED' && !draft.archivedAt && current.sources.every(source => source.availability === 'CURRENT')
  const canApprove = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  async function refresh() {
    setLoading(true); setError('')
    try {
      const next = await getDraft(id)
      setDraft(next)
      const content = next.revisions?.find(revision => revision.id === next.currentRevisionId)?.content ?? ''
      setText(content); setSavedText(content)
      const sources = next.revisions?.flatMap(revision => revision.sources) ?? []
      const groups = new Map<string, DraftSource>()
      for (const source of sources) groups.set(`${source.documentId}:${source.versionId}`, source)
      const resolved = await Promise.all([...groups].map(async ([key, source]) => {
        if (source.availability !== 'CURRENT') return { key, source, passages: [] as Context['passages'], truncated: false }
        try {
          const inspected = await inspectDocumentVersion(source.documentId, source.versionId)
          return { key, source, truncated: inspected.truncated, passages: inspected.availability === 'CURRENT'
            ? inspected.chunks.filter(chunk => sources.some(ref => ref.chunkId === chunk.id)) : [] }
        } catch { return { key, source, passages: [] as Context['passages'], truncated: false } }
      }))
      setContexts(resolved)
    } catch (cause) { setError(getErrorMessage(cause, 'Could not load this saved draft.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [id])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const confirmNavigation = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor || new URL(anchor.href).origin !== window.location.origin) return
      if (!window.confirm('Discard unsaved edits and leave this draft?')) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', confirmNavigation, true)
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', confirmNavigation, true) }
  }, [dirty])

  async function save() {
    if (!draft || !current || !text.trim() || !dirty) return
    setBusy('save'); setError(''); setSaveConflict(false); setStatus('Saving this revision…')
    try { const result = await saveDraftRevision(draft.id, current.id, text.trim()); setDraft(result); const content = result.revisions?.find(revision => revision.id === result.currentRevisionId)?.content ?? text.trim(); setText(content); setSavedText(content); setStatus('Saved. This revision needs review again.') }
    catch (cause) { setStatus(''); setSaveConflict(axios.isAxiosError(cause) && cause.response?.status === 409); setError(`${getErrorMessage(cause, 'Could not save this revision.')} Your edits are still here.`) }
    finally { setBusy('') }
  }
  async function approve() {
    if (!draft || !current || dirty) return
    setBusy('approve'); setError(''); setStatus('')
    try { await approveDraftRevision(draft.id, current.id); await refresh(); setStatus('Current revision approved.'); }
    catch (cause) { setError(getErrorMessage(cause, 'Could not approve this revision.')) }
    finally { setBusy('') }
  }
  async function copy() {
    if (!draft || !current || dirty || !text.trim()) return
    setBusy('copy'); setError(''); setStatus('')
    try { const exported = await requestDraftRevisionExport({ draftId: draft.id, revisionId: current.id, includeSources: true }); await navigator.clipboard.writeText(exported.text); await confirmDraftRevisionCopied(draft.id, exported.exportId); setStatus('Copied. Delivery is not recorded; paste the reply where you intend to use it.') }
    catch { setError('Could not copy or record clipboard success. The saved draft is unchanged; select the text and copy it manually if needed.') }
    finally { setBusy('') }
  }
  async function saveLibrary() {
    if (!draft || !current || !currentApproved || !current.sources.length || dirty || current.isRefusal) return
    setBusy('library'); setError(''); setStatus('')
    try { await saveDraftToLibrary({ draftId: draft.id, revisionId: current.id, title: draft.title || draft.question.slice(0, 120) }); setStatus('Saved to approved answers.') }
    catch (cause) { setError(getErrorMessage(cause, 'Could not save to approved answers.')) }
    finally { setBusy('') }
  }
  function back() {
    if (dirty && !window.confirm('Discard unsaved edits and return to drafts?')) return
    navigate('/draft')
  }

  if (loading) return <p role="status" className="text-sm text-zinc-400">Loading saved draft…</p>
  if (!draft) return <div className="space-y-4"><p role="alert" className="text-red-300">{error || 'Draft not found.'}</p><Link className="underline" to="/draft">Back to drafts</Link></div>
  const statusLabel = draft.archivedAt ? 'Archived' : currentApproved ? 'Approved current revision' : draft.reviewStatus === 'APPROVED' ? 'Approval needs review: sources changed' : 'Review required'
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><button className="text-sm text-zinc-400 underline" onClick={back}>← Drafts</button><h1 className="mt-2 text-2xl font-semibold text-white">Review reply</h1><Link className="mt-1 inline-block text-sm text-zinc-400 underline" to="/approved-answers">Approved answers library</Link></div><span className="rounded border border-white/10 px-3 py-1 text-sm text-zinc-300">{statusLabel}</span></div>
    {error && <div role="alert" className="rounded border border-red-500/30 p-3 text-sm text-red-300"><p>{error}</p>{saveConflict && <Button className="mt-2" onClick={() => { if (window.confirm('Reload the latest server revision and discard your local edits?')) { setSaveConflict(false); void refresh() } }}>Reload current revision</Button>}</div>}{status && <p role="status" className="text-sm text-zinc-300">{status}</p>}
    <Card><h2 className="text-sm font-semibold text-zinc-200">Buyer question</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-100">{draft.question}</p>{draft.reusedApprovedAnswerId && <p className="mt-2 text-xs text-amber-200">Started from an approved answer. This draft is unapproved and must be reviewed.</p>}</Card>
    {!current ? <Card><h2 className="font-medium text-amber-200">{draft.processingStatus === 'FAILED' ? 'Draft could not be prepared' : 'Draft is still being prepared'}</h2><p className="mt-2 text-sm text-zinc-300">{draft.generationErrorCode || draft.processingStatus}</p><Button className="mt-3" onClick={() => void refresh()}>Reload</Button></Card> : <>
      {current.isRefusal && <Card><h2 className="font-medium text-amber-200">More information needed</h2><p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">This response is a refusal or partial-evidence notice. Add the missing supported information before approval.</p></Card>}
      <div className="grid items-start gap-5 lg:grid-cols-2"><Card><label htmlFor="draft-reply" className="block text-sm font-medium text-zinc-200">Reply · revision {current.revisionNumber}</label><p className="my-2 text-xs text-zinc-400">Editing creates a new revision and clears its approval. Check each factual claim against its source.</p><textarea id="draft-reply" rows={16} className={area} value={text} disabled={!!draft.archivedAt} onChange={event => { setText(event.target.value); setStatus('') }} />
        <div className="mt-4 flex flex-wrap gap-2"><Button disabled={!dirty || !text.trim() || !!draft.archivedAt} loading={busy === 'save'} onClick={() => void save()}>Save revision</Button><Button disabled={!canApprove || dirty || current.isRefusal || !!draft.archivedAt || current.sources.some(source => source.availability !== 'CURRENT')} loading={busy === 'approve'} onClick={() => void approve()}>Approve current revision</Button><Button disabled={dirty || !!draft.archivedAt} loading={busy === 'copy'} onClick={() => void copy()}>Copy saved revision</Button>{currentApproved && current.sources.length > 0 && <Button disabled={dirty || current.isRefusal} loading={busy === 'library'} onClick={() => void saveLibrary()}>Save to approved answers</Button>}</div>
      </Card><Card><h2 className="text-sm font-semibold text-white">Source context</h2><p className="mt-2 text-xs text-zinc-400">Source text is shown only while its exact document version remains current.</p>{current.sources.length === 0 && <p className="mt-3 text-sm text-amber-200">No source passages are linked to this revision.</p>}<ol className="mt-3 space-y-4">{current.sources.map(source => <li key={source.chunkId} className="rounded-lg border border-white/10 p-3"><h3 className="text-sm font-medium text-zinc-100">{source.displayName || 'Source unavailable'}</h3><p className="mt-1 text-xs text-zinc-400">{source.availability}{source.pageNumber != null ? ` · Page ${source.pageNumber}` : source.chunkIndex != null ? ` · Passage ${source.chunkIndex + 1}` : ''}{source.sectionTitle ? ` · ${source.sectionTitle}` : ''}</p>{source.availability === 'CURRENT' ? <>{contexts.flatMap(context => context.passages.filter(passage => passage.id === source.chunkId).map(passage => <p key={passage.id} className="mt-3 whitespace-pre-wrap break-words text-sm text-zinc-300">{passage.text}</p>))}{!contexts.some(context => context.passages.some(passage => passage.id === source.chunkId)) && <p className="mt-2 text-sm text-amber-200">Passage text could not be loaded. Open Knowledge to inspect this source.</p>}</> : <p className="mt-2 text-sm text-amber-200">This reference is stale or unavailable. Do not treat its approval as current.</p>}</li>)}</ol></Card></div>
      <Card><h2 className="font-medium text-zinc-100">Revision history</h2><ol className="mt-3 space-y-3">{(draft.revisions ?? []).map(revision => <li key={revision.id} className="border-t border-white/10 pt-3"><p className="text-sm text-zinc-200">Revision {revision.revisionNumber} · {revision.origin.toLowerCase()} · {new Date(revision.createdAt).toLocaleString()} {revision.id === draft.currentRevisionId && '· current'}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-400">{revision.content}</p><p className="mt-1 text-xs text-zinc-500">{revision.sources.length} linked source{revision.sources.length === 1 ? '' : 's'} · {revision.isRefusal ? 'refusal/partial evidence' : 'answer'}</p></li>)}</ol></Card>
    </>}
  </div>
}
