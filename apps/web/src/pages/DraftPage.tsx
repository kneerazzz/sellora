import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { askQuestion, type AnswerResult } from '@/api/answers'
import { getErrorMessage } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

const textAreaClass = 'w-full rounded-lg border border-white/10 bg-zinc-900/80 px-3 py-3 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-500/30 disabled:opacity-60'

export function DraftPage() {
  const [question, setQuestion] = useState('')
  const [submittedQuestion, setSubmittedQuestion] = useState('')
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [draft, setDraft] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = question.trim()
    if (loading || trimmed.length < 3 || trimmed.length > 4000) return
    if (result && !window.confirm('Replace this draft? Your edits on this page are not saved.')) return
    setLoading(true)
    setError('')
    setCopyStatus('')
    setResult(null)
    setDraft('')
    setReviewed(false)
    setSubmittedQuestion(trimmed)
    try {
      const answer = await askQuestion(trimmed)
      setResult(answer)
      setDraft(answer.refused ? '' : answer.answer)
    } catch (err) {
      setError(getErrorMessage(err, 'Could not create a draft. Try again.'))
    } finally {
      setLoading(false)
    }
  }

  async function copyDraft() {
    if (!reviewed || !draft.trim() || result?.refused) return
    try {
      await navigator.clipboard.writeText(draft)
      setCopyStatus('Copied. Paste the reviewed reply into your email.')
    } catch {
      setCopyStatus('Clipboard access is unavailable. Select the draft text and copy it manually.')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Draft a reply</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Ask a buyer question using your company knowledge, then check the sources and edit the reply.
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Start with approved documents in <Link className="underline text-zinc-200" to="/documents">Knowledge</Link>.
          {' '}Draft edits and review checks last only while this page is open. Nothing is sent automatically.
        </p>
      </div>

      <Card>
        <form onSubmit={generate} className="space-y-3">
          <label htmlFor="buyer-question" className="block text-sm font-medium text-zinc-200">Buyer question</label>
          <textarea id="buyer-question" className={textAreaClass} rows={4} maxLength={4000}
            required disabled={loading} value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="For example: Which single sign-on options do you support?" />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">{question.length}/4,000 characters</p>
            <Button type="submit" loading={loading} disabled={question.trim().length < 3}>
              {loading ? 'Preparing draft…' : result ? 'Create another draft' : 'Create draft'}
            </Button>
          </div>
        </form>
      </Card>

      {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</p>}
      {loading && <p role="status" className="text-sm text-zinc-400">Searching company documents and preparing a draft…</p>}

      {result && (
        <div className="space-y-4">
          <p className="whitespace-pre-wrap text-sm text-zinc-400"><span className="font-medium text-zinc-200">Question: </span>{submittedQuestion}</p>
          {result.refused ? (
            <Card>
              <h2 className="font-medium text-amber-200">More information needed</h2>
              <p role="status" className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{result.answer}</p>
              <p className="mt-3 text-sm text-zinc-400">Check that the relevant approved documents are ready, or ask a more specific question.</p>
            </Card>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <Card>
                <label htmlFor="reply-draft" className="block text-sm font-medium text-zinc-200">Reply draft</label>
                <p className="my-2 text-xs text-zinc-400">Check every factual claim before using this reply. Editing clears the review check.</p>
                <textarea id="reply-draft" rows={16} className={textAreaClass} value={draft}
                  onChange={(event) => { setDraft(event.target.value); setReviewed(false); setCopyStatus('') }} />
                <label className="mt-4 flex items-start gap-2 text-sm text-zinc-300">
                  <input type="checkbox" checked={reviewed} disabled={!draft.trim() || result.citations.length === 0}
                    className="mt-1" onChange={(event) => { setReviewed(event.target.checked); setCopyStatus('') }} />
                  I checked the sources and reviewed this version of the reply.
                </label>
                <Button type="button" className="mt-4" disabled={!reviewed || !draft.trim()} onClick={copyDraft}>Copy reviewed reply</Button>
                {copyStatus && <p role="status" className="mt-3 text-sm text-zinc-300">{copyStatus}</p>}
              </Card>
              <Card>
                <h2 className="text-sm font-semibold text-white">Sources to review</h2>
                <p className="mt-2 text-xs text-zinc-400">These passages were retrieved for the question. They may not support every claim in the draft.</p>
                {result.citations.length === 0 && <p role="alert" className="mt-4 text-sm text-amber-200">No sources were returned. This draft cannot be marked reviewed here.</p>}
                <ol className="mt-4 space-y-4">
                  {result.citations.map((citation, index) => (
                    <li key={citation.chunkId} className="rounded-lg border border-white/10 p-3">
                      <h3 className="text-sm font-medium text-zinc-200">{index + 1}. {citation.documentName}</h3>
                      <p className="mt-1 text-xs text-zinc-500">{citation.filename}
                        {citation.pageNumber != null ? ` · Page ${citation.pageNumber}` : ` · Passage ${citation.chunkIndex + 1}`}
                      </p>
                      <p className="mt-3 whitespace-pre-wrap break-words text-sm text-zinc-300">{citation.snippet}</p>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
