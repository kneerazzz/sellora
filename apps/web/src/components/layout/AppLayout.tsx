import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Header } from './Header'
import { Sidebar, navItems } from './Sidebar'

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="min-h-screen bg-zinc-950">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <Header sidebarCollapsed={collapsed} />
      <main
        className={cn(
          'min-h-screen pb-20 pt-16 transition-all duration-300 sm:pb-0',
          collapsed ? 'sm:pl-[72px]' : 'sm:pl-64'
        )}
      >
        <div className="mx-auto max-w-7xl p-4 sm:p-6">
          <Outlet />
        </div>
      </main>
      <nav aria-label="Mobile navigation" className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-6 border-t border-white/10 bg-zinc-950/95 sm:hidden">
        {navItems.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end}
          aria-label={label} className={({ isActive }) => cn('flex min-w-0 flex-col items-center gap-1 px-1 py-3 text-[10px]', isActive ? 'text-white' : 'text-zinc-400')}>
          <Icon className="h-4 w-4" /><span className="truncate">{label}</span>
        </NavLink>)}
      </nav>
    </div>
  )
}
