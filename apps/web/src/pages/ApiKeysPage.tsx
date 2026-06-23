import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Plus, Trash2 } from 'lucide-react'
import { createApiKey, listApiKeys, revokeApiKey } from '@/api/apiKeys'
import { getErrorMessage } from '@/api/client'
import type { ApiKey } from '@/types/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'

export function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [rawKey, setRawKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { items } = await listApiKeys({ limit: 50 })
      setKeys(items)
      setError('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate() {
    if (!label.trim()) return
    setCreating(true)
    setError('')
    try {
      const result = await createApiKey({ label: label.trim(), scope: 'WEBHOOK_ONLY' })
      setRawKey(result.rawKey)
      setLabel('')
      setShowCreate(false)
      await load()
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create API key'))
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? Connected integrations will stop working.')) return
    try {
      await revokeApiKey(id)
      await load()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  async function copyKey() {
    if (!rawKey) return
    await navigator.clipboard.writeText(rawKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">API Keys</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Generate keys for n8n and external webhook integrations.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New API key
        </Button>
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
              <th className="px-5 py-3 font-medium">Label</th>
              <th className="px-5 py-3 font-medium">Prefix</th>
              <th className="px-5 py-3 font-medium">Scope</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Last used</th>
              <th className="px-5 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-zinc-500">
                  Loading keys…
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-zinc-500">
                  No API keys yet.
                </td>
              </tr>
            ) : (
              keys.map((key) => (
                <tr
                  key={key.id}
                  className="border-b border-white/5 transition-colors hover:bg-white/[0.02]"
                >
                  <td className="px-5 py-4 font-medium text-zinc-100">{key.label}</td>
                  <td className="px-5 py-4 font-mono text-xs text-zinc-400">{key.keyPrefix}…</td>
                  <td className="px-5 py-4 text-zinc-400">{key.scope}</td>
                  <td className="px-5 py-4">
                    <Badge
                      className={
                        key.isActive
                          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
                          : 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30'
                      }
                    >
                      {key.isActive ? 'Active' : 'Revoked'}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-zinc-400">{formatDate(key.lastUsedAt)}</td>
                  <td className="px-5 py-4 text-right">
                    {key.isActive && (
                      <Button
                        variant="ghost"
                        className="!p-2 text-red-400 hover:text-red-300"
                        onClick={() => handleRevoke(key.id)}
                        aria-label="Revoke key"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create API key"
        description="Give your key a label so you can identify it later."
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} loading={creating}>
              Generate
            </Button>
          </>
        }
      >
        <Input
          label="Label"
          placeholder="n8n Production Webhook"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          autoFocus
        />
      </Modal>

      <Modal
        open={Boolean(rawKey)}
        onClose={() => setRawKey(null)}
        title="Your API key"
        description="Copy this key now. You won't be able to see it again."
        className="max-w-xl"
        footer={
          <Button onClick={copyKey} className="gap-2">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied!' : 'Copy to clipboard'}
          </Button>
        }
      >
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <code className="block break-all font-mono text-sm text-amber-100">{rawKey}</code>
        </div>
      </Modal>
    </div>
  )
}
