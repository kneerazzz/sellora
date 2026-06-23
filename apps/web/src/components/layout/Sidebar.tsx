import { NavLink } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  KeyRound,
  LayoutDashboard,
  Users,
  Workflow,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/api-keys', label: 'API Keys', icon: KeyRound },
  { to: '/workflow-runs', label: 'Workflow Runs', icon: Workflow },
  { to: '/team', label: 'Team', icon: Users },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 flex h-screen flex-col border-r border-white/10 glass transition-all duration-300',
        collapsed ? 'w-[72px]' : 'w-64'
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 ring-1 ring-white/10">
          <Zap className="h-4 w-4 text-zinc-200" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Sellora</p>
            <p className="truncate text-xs text-zinc-500">Admin Panel</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-white/10 text-white shadow-sm'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={onToggle}
        className="m-3 flex items-center justify-center rounded-lg border border-white/10 p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  )
}
