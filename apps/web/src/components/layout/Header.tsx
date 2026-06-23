import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, LogOut } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { cn, getInitials } from '@/lib/utils'
import { Button } from '@/components/ui/Button'

const routeLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/documents': 'Documents',
  '/api-keys': 'API Keys',
  '/workflow-runs': 'Workflow Runs',
  '/team': 'Team',
}

interface HeaderProps {
  sidebarCollapsed: boolean
}

export function Header({ sidebarCollapsed }: HeaderProps) {
  const { user, logout } = useAuth()
  const location = useLocation()

  const segments = location.pathname.split('/').filter(Boolean)
  const crumbs = segments.length === 0 ? ['Dashboard'] : segments.map((s) => routeLabels[`/${s}`] ?? s)

  return (
    <header
      className={cn(
        'fixed top-0 right-0 z-20 flex h-16 items-center justify-between border-b border-white/10 glass px-6 transition-all duration-300',
        sidebarCollapsed ? 'left-[72px]' : 'left-64'
      )}
    >
      <nav className="flex items-center gap-1.5 text-sm text-zinc-500">
        <Link to="/" className="transition-colors hover:text-zinc-300">
          Home
        </Link>
        {crumbs.map((crumb, i) => (
          <span key={`${crumb}-${i}`} className="flex items-center gap-1.5">
            <ChevronRight className="h-3.5 w-3.5" />
            <span className={i === crumbs.length - 1 ? 'text-zinc-200' : ''}>{crumb}</span>
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-zinc-100">
            {user?.firstName} {user?.lastName}
          </p>
          <p className="text-xs text-zinc-500">{user?.organization?.name ?? user?.role}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-zinc-200 ring-1 ring-white/10">
          {user ? getInitials(user.firstName, user.lastName) : '?'}
        </div>
        <Button variant="ghost" className="!p-2" onClick={() => logout()} aria-label="Log out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
