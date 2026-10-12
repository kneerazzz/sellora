import { useEffect, useState } from 'react'
import { getErrorMessage } from '@/api/client'
import { getUsageSummary, setUsagePause, type UsageSummary } from '@/api/usage'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

export function UsagePage() {
  const { user } = useAuth()
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    try {
      setSummary(await getUsageSummary())
      setError('')
    } catch (cause) {
      setError(getErrorMessage(cause))
    }
  }

  useEffect(() => { void reload() }, [])

  async function togglePause() {
    if (!summary) return
    setBusy(true)
    try {
      await setUsagePause(!summary.paused)
      await reload()
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return <div className="space-y-6">
    <div className="flex items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold text-white">Usage controls</h1>
        <p className="mt-1 text-sm text-zinc-400">Organization provider workload and recent events.</p></div>
      {user?.role === 'ADMIN' && <Button onClick={togglePause} disabled={!summary || busy}>
        {summary?.paused ? 'Resume new work' : 'Pause new work'}
      </Button>}
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {summary && <>
      <Card><p className="text-sm text-zinc-300">{summary.paused ? 'New expensive work is paused.' : 'New expensive work is enabled.'}</p>
        <p className="mt-3 text-xl text-white">{summary.remainingUnits.toLocaleString()} remaining of {summary.maxUnits.toLocaleString()} units</p>
        <p className="mt-1 text-sm text-zinc-400">Rolling period since {new Date(summary.periodStart).toLocaleString()}; {summary.usedUnits.toLocaleString()} used. {summary.activeReservations} active of {summary.maxConcurrent} concurrent slots.</p>
        <p className="mt-2 text-sm text-amber-300">{summary.unknownAttempts} unknown attempt measurements; {summary.unknownReservations} unknown reservations.</p>
        <p className="mt-2 text-xs text-zinc-500">{summary.measurementNotice}</p></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h2 className="font-medium text-white">Recent failed or cancelled work</h2>
          {summary.failedTraces.length === 0 ? <p className="mt-3 text-sm text-zinc-400">None in this period.</p> :
            <ul className="mt-3 space-y-2 text-sm text-zinc-300">{summary.failedTraces.map(trace =>
              <li key={trace.id}>{trace.operation} · {trace.status} · {new Date(trace.createdAt).toLocaleString()}</li>)}</ul>}</Card>
        <Card><h2 className="font-medium text-white">Largest reserved work</h2>
          {summary.costlyTraces.length === 0 ? <p className="mt-3 text-sm text-zinc-400">None in this period.</p> :
            <ul className="mt-3 space-y-2 text-sm text-zinc-300">{summary.costlyTraces.map(trace =>
              <li key={trace.id}>{trace.operation} · {trace.reservedUnits?.toLocaleString() ?? 'unknown'} units · {trace.status}</li>)}</ul>}</Card>
      </div>
      <Card><h2 className="font-medium text-white">Alert events</h2>
        <p className="mt-1 text-xs text-zinc-500">Events are recorded here; no notification delivery is configured.</p>
        {summary.alerts.length === 0 ? <p className="mt-3 text-sm text-zinc-400">No recent events.</p> :
          <ul className="mt-3 space-y-2 text-sm text-zinc-300">{summary.alerts.map(alert =>
            <li key={alert.id}>{alert.kind.replaceAll('_', ' ')} · {new Date(alert.createdAt).toLocaleString()}</li>)}</ul>}</Card>
    </>}
  </div>
}
