import { useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { marked } from 'marked'
import {
  askQuestion,
  clearStoredMessages,
  getConfig,
  loadMessages,
  saveMessages,
  uid,
  type ChatMessage,
  type Citation,
} from './api'

marked.setOptions({ breaks: true })

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  )
}

function CitationList({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!citations.length) return null

  return (
    <div class="sc-citations">
      <div class="sc-citations-label">Sources</div>
      {citations.map((c, i) => (
        <div class="sc-citation" key={c.chunkId}>
          <button
            type="button"
            class="sc-citation-btn"
            onClick={() => setOpen(open === i ? null : i)}
          >
            <span class="sc-citation-num">{i + 1}</span>
            <span class="sc-citation-name">{c.documentName}</span>
            {c.pageNumber != null && <span style={{ color: '#71717a' }}>p.{c.pageNumber}</span>}
          </button>
          {open === i && <div class="sc-citation-body">{c.snippet}</div>}
        </div>
      ))}
    </div>
  )
}

function Message({ msg }: { msg: ChatMessage }) {
  if (msg.role === 'user') {
    return (
      <div class="sc-row sc-row-user">
        <div class="sc-bubble sc-bubble-user">{msg.content}</div>
      </div>
    )
  }

  const html = marked.parse(msg.content) as string
  const confClass =
    msg.confidence === 'HIGH'
      ? 'sc-confidence-high'
      : msg.confidence === 'MEDIUM'
        ? 'sc-confidence-medium'
        : 'sc-confidence-low'

  return (
    <div class="sc-row sc-row-ai">
      <div class="sc-bubble sc-bubble-ai">
        {msg.confidence && (
          <span class={`sc-confidence ${confClass}`}>{msg.confidence} confidence</span>
        )}
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {msg.citations && <CitationList citations={msg.citations} />}
      </div>
    </div>
  )
}

export function ChatWidget() {
  const { position } = getConfig()
  const isLeft = position === 'bottom-left'

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    saveMessages(messages)
  }, [messages])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  async function send() {
    const q = input.trim()
    if (!q || loading) return

    setInput('')
    setError('')
    setMessages((m) => [...m, { id: uid(), role: 'user', content: q }])
    setLoading(true)

    try {
      const result = await askQuestion(q)
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: 'assistant',
          content: result.answer,
          confidence: result.confidence,
          citations: result.citations,
        },
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function onKeyDown(e: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function clearChat() {
    setMessages([])
    clearStoredMessages()
  }

  return (
    <>
      {open && (
        <div class={`sc-panel${isLeft ? ' sc-left' : ''}`} role="dialog" aria-label="Sellora Copilot">
          <header class="sc-header">
            <div class="sc-header-title">
              <div class="sc-logo">
                <SparkIcon />
              </div>
              <div>
                <h2>Sellora Copilot</h2>
                <p>Ask about our product</p>
              </div>
            </div>
            <div class="sc-header-actions">
              <button type="button" class="sc-icon-btn" onClick={clearChat} title="Clear chat">
                <TrashIcon />
              </button>
              <button type="button" class="sc-icon-btn" onClick={() => setOpen(false)} title="Close">
                <CloseIcon />
              </button>
            </div>
          </header>

          <div class="sc-messages" ref={listRef}>
            {messages.length === 0 && !loading && (
              <div class="sc-empty">
                <div class="sc-empty-icon">
                  <SparkIcon />
                </div>
                <strong>How can I help?</strong>
                <span>Instant answers from our docs — with cited sources.</span>
              </div>
            )}
            {messages.map((m) => (
              <Message key={m.id} msg={m} />
            ))}
            {loading && (
              <div class="sc-row sc-row-ai">
                <div class="sc-bubble sc-bubble-ai sc-typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>

          {error && <div class="sc-error">{error}</div>}

          <div class="sc-input-area">
            <div class="sc-input-wrap">
              <textarea
                ref={inputRef}
                class="sc-input"
                rows={1}
                placeholder="Ask a question…"
                value={input}
                onInput={(e) => setInput((e.target as HTMLTextAreaElement).value)}
                onKeyDown={onKeyDown}
                disabled={loading}
              />
              <button
                type="button"
                class="sc-send"
                onClick={send}
                disabled={!input.trim() || loading}
                aria-label="Send"
              >
                <SendIcon />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        class={`sc-launcher${isLeft ? ' sc-left' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close chat' : 'Open chat'}
      >
        {open ? <CloseIcon /> : <SparkIcon />}
      </button>
    </>
  )
}
