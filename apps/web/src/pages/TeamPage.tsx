import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Mail, UserPlus, X } from 'lucide-react'
import { createInvite, listInvites, listTeamMembers, revokeInvite } from '@/api/team'
import { getErrorMessage } from '@/api/client'
import type { Invite, TeamMember } from '@/types/api'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { formatDate, getInitials } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'

const inviteStatusStyles: Record<string, string> = {
  PENDING: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  ACCEPTED: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  EXPIRED: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/30',
  REVOKED: 'bg-red-500/15 text-red-300 ring-red-500/30',
}

export function TeamPage() {
  const { user } = useAuth()
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER'

  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'MANAGER' | 'REP'>('REP')
  const [inviting, setInviting] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [teamResult, inviteResult] = await Promise.all([
        listTeamMembers({ limit: 50 }),
        canManage ? listInvites({ status: 'PENDING', limit: 50 }) : Promise.resolve({ items: [] }),
      ])
      setMembers(teamResult.items)
      setInvites(inviteResult.items)
      setError('')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [canManage])

  useEffect(() => {
    load()
  }, [load])

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setInviting(true)
    setError('')
    try {
      const result = await createInvite({ email: email.trim(), role })
      setInviteUrl(result.inviteUrl)
      setEmail('')
      await load()
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to send invite'))
    } finally {
      setInviting(false)
    }
  }

  async function handleRevokeInvite(id: string) {
    try {
      await revokeInvite(id)
      await load()
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Team</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Manage active members and invite new users to your organization.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {canManage && (
        <Card>
          <h2 className="text-sm font-semibold text-white">Invite team member</h2>
          <form onSubmit={handleInvite} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Email"
                type="email"
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="w-full sm:w-40">
              <label className="mb-1.5 block text-sm font-medium text-zinc-300">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as 'MANAGER' | 'REP')}
                className="w-full rounded-lg border border-white/10 bg-zinc-900/80 px-3 py-2.5 text-sm text-zinc-200"
              >
                {user?.role === 'ADMIN' && <option value="MANAGER">Manager</option>}
                <option value="REP">Rep</option>
              </select>
            </div>
            <Button type="submit" loading={inviting} className="gap-2 sm:mb-0">
              <UserPlus className="h-4 w-4" />
              Send invite
            </Button>
          </form>

          {inviteUrl && (
            <div className="mt-4 flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-emerald-200">Invite created</p>
                <p className="mt-1 break-all font-mono text-xs text-emerald-100/80">{inviteUrl}</p>
              </div>
              <button
                type="button"
                onClick={() => setInviteUrl(null)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">Active members</h2>
        <Card className="overflow-hidden !p-0">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-5 py-3 font-medium">Member</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 font-medium">Title</th>
                <th className="px-5 py-3 font-medium">Last login</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-zinc-500">
                    Loading team…
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr
                    key={member.id}
                    className="border-b border-white/5 transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200">
                          {getInitials(member.firstName, member.lastName)}
                        </div>
                        <div>
                          <p className="font-medium text-zinc-100">
                            {member.firstName} {member.lastName}
                            {member.id === user?.id && (
                              <span className="ml-2 text-xs text-zinc-500">(you)</span>
                            )}
                          </p>
                          <p className="text-xs text-zinc-500">{member.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-zinc-400">{member.role}</td>
                    <td className="px-5 py-4 text-zinc-400">{member.title ?? '—'}</td>
                    <td className="px-5 py-4 text-zinc-400">{formatDate(member.lastLoginAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </section>

      {canManage && invites.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-300">Pending invites</h2>
          <Card className="overflow-hidden !p-0">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Expires</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr
                    key={invite.id}
                    className="border-b border-white/5 transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-5 py-4 text-zinc-100">{invite.email}</td>
                    <td className="px-5 py-4 text-zinc-400">{invite.role}</td>
                    <td className="px-5 py-4 text-zinc-400">{formatDate(invite.expiresAt)}</td>
                    <td className="px-5 py-4">
                      <Badge className={inviteStatusStyles[invite.status]}>{invite.status}</Badge>
                    </td>
                    <td className="px-5 py-4 text-right">
                      {invite.status === 'PENDING' && (
                        <Button
                          variant="ghost"
                          className="!text-xs text-red-400"
                          onClick={() => handleRevokeInvite(invite.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </div>
  )
}
