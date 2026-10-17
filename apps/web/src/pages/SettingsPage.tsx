import { Link } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { Card } from '@/components/ui/Card'

export function SettingsPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER'
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold text-white">Settings</h1><p className="mt-1 text-sm text-zinc-400">Team access and workspace controls.</p></header>
    <div className="grid gap-4 sm:grid-cols-2">
      <Card><Link className="block rounded font-medium text-zinc-100 underline focus:outline-none focus:ring-2 focus:ring-zinc-400" to="/settings/team">Team</Link><p className="mt-2 text-sm text-zinc-400">See members and manage invite links.</p></Card>
      {canManage && <><Card><Link className="block rounded font-medium text-zinc-100 underline focus:outline-none focus:ring-2 focus:ring-zinc-400" to="/settings/api-keys">API keys</Link><p className="mt-2 text-sm text-zinc-400">Manage integration access.</p></Card>
      <Card><Link className="block rounded font-medium text-zinc-100 underline focus:outline-none focus:ring-2 focus:ring-zinc-400" to="/settings/usage">Usage</Link><p className="mt-2 text-sm text-zinc-400">Review workspace limits and activity.</p></Card></>}
    </div>
  </div>
}
