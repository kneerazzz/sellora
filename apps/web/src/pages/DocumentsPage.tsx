import { useCallback, useEffect, useRef, useState } from 'react'
import { Eye, Upload } from 'lucide-react'
import { deleteDocument, inspectDocumentVersion, listDocuments, listDocumentVersions,
  replaceDocumentFile, retryDocumentVersion, uploadDocumentFile } from '@/api/documents'
import { getErrorMessage } from '@/api/client'
import { useAuth } from '@/context/AuthContext'
import type { Document, DocumentVersion, SourceInspection } from '@/types/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { documentStatusLabel, documentStatusStyles, mapDocumentStatus } from '@/lib/documentStatus'
import { formatBytes, formatDate } from '@/lib/utils'

const acceptedFiles = '.txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function DocumentsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState('')
  const [error, setError] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [versions, setVersions] = useState<DocumentVersion[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [inspection, setInspection] = useState<SourceInspection | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const selected = documents.find(document => document.id === detailId) ?? null

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { items } = await listDocuments({ limit: 50 })
      setDocuments(items)
      setError('')
    } catch (err) { setError(getErrorMessage(err)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const loadVersions = async (id: string) => {
    setDetailLoading(true)
    try { setVersions(await listDocumentVersions(id)); setDetailError('') }
    catch (err) { setDetailError(getErrorMessage(err)) }
    finally { setDetailLoading(false) }
  }
  const refresh = async (id?: string) => { await load(); if (id) await loadVersions(id) }
  const openDetail = (id: string) => {
    setDetailId(id); setVersions([]); setInspection(null); setConfirmDelete(false)
    void loadVersions(id)
  }
  const handleFile = async (file: File, replacement?: Document) => {
    const controller = new AbortController()
    abortRef.current = controller
    setPending(replacement ? 'Replacing source' : 'Uploading source')
    setError(''); setDetailError('')
    try {
      if (replacement) await replaceDocumentFile(replacement.id, replacement.activeVersionId, file, controller.signal)
      else await uploadDocumentFile(file, undefined, controller.signal)
      await refresh(replacement?.id)
      setInspection(null)
    } catch (err) {
      const message = controller.signal.aborted
        ? 'Request cancelled. The server may still finish; refresh before making another change.'
        : getErrorMessage(err, replacement ? 'Replacement failed' : 'Upload failed')
      await refresh(replacement?.id)
      if (replacement) setDetailError(message); else setError(message)
    } finally { abortRef.current = null; setPending('') }
  }
  const retry = async (version: DocumentVersion) => {
    if (!selected) return
    setPending('Retrying version'); setDetailError('')
    try { await retryDocumentVersion(selected.id, version.id); await refresh(selected.id); setInspection(null) }
    catch (err) { await refresh(selected.id); setDetailError(getErrorMessage(err, 'Retry failed')) }
    finally { setPending('') }
  }
  const remove = async () => {
    if (!selected || !confirmDelete) return
    setPending('Deleting source'); setDetailError('')
    try {
      await deleteDocument(selected.id, selected.activeVersionId)
      await refresh(selected.id); setInspection(null); setConfirmDelete(false)
    } catch (err) { await refresh(selected.id); setDetailError(getErrorMessage(err, 'Delete failed')) }
    finally { setPending('') }
  }
  const inspect = async (version: DocumentVersion) => {
    if (!selected) return
    setDetailError('')
    try { setInspection(await inspectDocumentVersion(selected.id, version.id)) }
    catch (err) { setDetailError(getErrorMessage(err, 'Inspection failed')) }
  }

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-2xl font-semibold text-white">Knowledge</h1>
        <p className="mt-1 text-sm text-zinc-400">Sources used for staff-reviewed draft replies. Older and deleted versions are excluded from new answers.</p></div>
      {canManage && <div className="flex gap-2">
        <input ref={fileRef} type="file" accept={acceptedFiles} className="hidden" onChange={event => {
          const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ''
        }} />
        <Button disabled={!!pending} onClick={() => fileRef.current?.click()} className="gap-2">
          <Upload className="h-4 w-4" />Upload document</Button>
        {abortRef.current && <Button variant="secondary" onClick={() => abortRef.current?.abort()}>Cancel request</Button>}
      </div>}
    </div>
    {pending && <p role="status" className="text-sm text-blue-300">{pending}…</p>}
    {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}
    <Card className="overflow-hidden !p-0"><div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
        {['Name', 'Type', 'Size', 'Status', 'Chunks', 'Uploaded', 'Details'].map(label =>
          <th key={label} className="px-5 py-3 font-medium">{label}</th>)}
      </tr></thead>
      <tbody>{loading && documents.length === 0
        ? <tr><td colSpan={7} className="px-5 py-10 text-center text-zinc-500">Loading documents…</td></tr>
        : documents.length === 0
          ? <tr><td colSpan={7} className="px-5 py-10 text-center text-zinc-500">{canManage ? 'No documents yet. Upload a company document to give draft replies a source.' : 'No documents yet. Ask a manager to upload a company document.'}</td></tr>
          : documents.map(doc => {
            const status = mapDocumentStatus(doc.status)
            return <tr key={doc.id} className="border-b border-white/5">
              <td className="px-5 py-4"><p className="font-medium text-zinc-100">{doc.displayName}</p>
                <p className="text-xs text-zinc-500">{doc.filename} · ID {doc.id.slice(-8)}</p></td>
              <td className="px-5 py-4 text-zinc-400">{doc.fileType}</td>
              <td className="px-5 py-4 text-zinc-400">{formatBytes(doc.sizeBytes)}</td>
              <td className="px-5 py-4"><Badge className={documentStatusStyles[status]}>{documentStatusLabel[status]}</Badge>
                {doc.errorMessage && <p className="mt-1 max-w-xs text-xs text-red-300">{doc.errorMessage}</p>}</td>
              <td className="px-5 py-4 text-zinc-400">{doc.totalChunks ?? '—'}</td>
              <td className="px-5 py-4 text-zinc-400">{formatDate(doc.createdAt)}</td>
              <td className="px-5 py-4"><Button variant="ghost" onClick={() => openDetail(doc.id)}
                aria-label={`Inspect ${doc.displayName} ${doc.id}`}><Eye className="h-4 w-4" /></Button></td>
            </tr>
          })}</tbody>
    </table></div></Card>
    <Modal open={!!detailId} onClose={() => { if (!pending) setDetailId(null) }}
      title={selected?.displayName ?? 'Document'}
      description={selected ? `Document ID ${selected.id} · ${selected.status}` : undefined}
      className="max-h-[90vh] max-w-3xl overflow-y-auto">
      {detailError && <p role="alert" className="mb-4 text-sm text-red-300">{detailError}</p>}
      {detailLoading && <p className="text-sm text-zinc-400">Loading versions…</p>}
      {selected && <div className="space-y-4">
        {selected.errorMessage && <p className="text-sm text-red-300">{selected.errorMessage}</p>}
        {selected.deletedAt && <p className="text-sm text-amber-300">Deleted source: old citations are unavailable. Originals await retention policy.</p>}
        {canManage && !selected.deletedAt && <div className="flex flex-wrap gap-2">
          <input ref={replaceRef} type="file" accept={acceptedFiles} className="hidden" onChange={event => {
            const file = event.target.files?.[0]; if (file) void handleFile(file, selected); event.target.value = ''
          }} />
          <Button variant="secondary" disabled={!!pending} onClick={() => replaceRef.current?.click()}>Replace file</Button>
          <Button variant="danger" disabled={!!pending} onClick={() => setConfirmDelete(true)}>Delete source</Button>
          {abortRef.current && <Button variant="secondary" onClick={() => abortRef.current?.abort()}>Cancel request</Button>}
        </div>}
        {confirmDelete && !selected.deletedAt && <div className="rounded-lg border border-red-500/30 p-3 text-sm">
          <p className="text-red-200">Remove {selected.displayName} ({selected.id.slice(-8)}) from new answers? Historical files remain pending retention policy.</p>
          <div className="mt-2 flex gap-2"><Button variant="danger" disabled={!!pending} onClick={() => void remove()}>Confirm delete</Button>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep source</Button></div>
        </div>}
        <section className="space-y-2"><h3 className="font-medium text-zinc-100">Versions</h3>
          {!detailLoading && versions.length === 0 && <p className="text-sm text-zinc-400">No versions available.</p>}
          {versions.map(version => <div key={version.id} className="rounded-lg border border-white/10 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-medium text-zinc-100">Version {version.versionNumber} · {version.status}
                {selected.activeVersionId === version.id && !selected.deletedAt ? ' · current' : ''}</p>
                <p className="text-xs text-zinc-400">{version.filename} · {formatDate(version.createdAt)} · {version.totalChunks ?? 0} chunks</p>
                {version.errorMessage && <p className="text-xs text-red-300">{version.errorMessage}</p>}</div>
              <div className="flex gap-2"><Button variant="ghost" onClick={() => void inspect(version)}>Inspect</Button>
                {canManage && version.status === 'FAILED' && !selected.deletedAt &&
                  <Button variant="secondary" disabled={!!pending} onClick={() => void retry(version)}>Retry</Button>}</div>
            </div>
          </div>)}
        </section>
        {inspection && <section className="rounded-lg border border-white/10 p-3 text-sm" aria-label="Source inspection">
          <h3 className="font-medium text-zinc-100">Version {inspection.versionNumber} · {inspection.availability}</h3>
          {inspection.availability !== 'CURRENT' &&
            <p className="mt-2 text-amber-300">Passage unavailable; historical references are stale or unavailable.</p>}
          {inspection.chunks.map(chunk => <div key={chunk.id} className="mt-3 border-t border-white/10 pt-2">
            <p className="text-xs text-zinc-400">{chunk.pageNumber != null ? `Page ${chunk.pageNumber}`
              : chunk.headingPath.length ? chunk.headingPath.join(' › ') : chunk.sectionTitle ?? `Passage ${chunk.chunkIndex + 1}`}</p>
            <p className="mt-1 whitespace-pre-wrap text-zinc-200">{chunk.text}</p>
          </div>)}
          {inspection.truncated && <p className="mt-2 text-amber-300">Showing the first 100 passages.</p>}
        </section>}
      </div>}
    </Modal>
  </div>
}
