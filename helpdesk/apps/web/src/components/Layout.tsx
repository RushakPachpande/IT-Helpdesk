import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardList,
  FileText,
  Globe,
  Inbox,
  LifeBuoy,
  ListChecks,
  LogOut,
  Mail,
  PlusCircle,
  Settings,
  Users,
} from 'lucide-react'
import { ROLE_LABELS } from '@helpdesk/shared'
import { api } from '@/lib/api'
import { useIsStaff, useMe } from '@/lib/auth'
import { useRealtime } from '@/lib/realtime'
import { cn } from '@/lib/utils'

function NavLink({ to, icon: Icon, children, count }: { to: string; icon: typeof Inbox; children: React.ReactNode; count?: number }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
      activeProps={{ className: 'bg-slate-800 text-white' }}
      activeOptions={{ exact: to === '/tickets' }}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{children}</span>
      {count ? <span className="rounded-full bg-blue-600 px-2 text-xs font-semibold text-white">{count}</span> : null}
    </Link>
  )
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

export function Layout() {
  const me = useMe()
  const staff = useIsStaff()
  const qc = useQueryClient()
  const navigate = useNavigate()
  useRealtime(true)

  const counts = useQuery({
    queryKey: ['counts'],
    queryFn: () => api<{ needsReview: number; unassigned: number; mine: number; active: number }>('/api/tickets/counts'),
    enabled: staff,
    refetchInterval: 60_000,
  })

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    qc.clear()
    await navigate({ to: '/login' })
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 px-3 py-4">
        <div className="flex items-center gap-2 px-3 pb-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-600">
            <LifeBuoy className="h-5 w-5 text-white" />
          </div>
          <span className="font-semibold text-white">IT Helpdesk</span>
        </div>

        <nav className="flex-1 overflow-y-auto">
          <NavSection title="Support">
            <NavLink to="/tickets/new" icon={PlusCircle}>New request</NavLink>
            <NavLink to="/tickets" icon={FileText}>My requests</NavLink>
          </NavSection>

          {staff && (
            <NavSection title="IT team">
              <NavLink to="/queue" icon={Inbox} count={counts.data?.active}>Queue</NavLink>
              <NavLink to="/review" icon={ClipboardList} count={counts.data?.needsReview}>Needs review</NavLink>
            </NavSection>
          )}

          {me.role === 'ADMIN' && (
            <NavSection title="Admin">
              <NavLink to="/admin/users" icon={Users}>Users</NavLink>
              <NavLink to="/admin/domains" icon={Globe}>Allowed domains</NavLink>
              <NavLink to="/admin/lists" icon={ListChecks}>Categories & priorities</NavLink>
              <NavLink to="/admin/mailbox" icon={Mail}>Support mailbox</NavLink>
              <NavLink to="/admin/settings" icon={Settings}>Settings</NavLink>
              <NavLink to="/admin/audit" icon={ClipboardList}>Audit log</NavLink>
            </NavSection>
          )}
        </nav>

        <div className="mt-4 border-t border-slate-800 px-3 pt-4">
          <p className="truncate text-sm font-medium text-white">{me.name}</p>
          <p className="truncate text-xs text-slate-400">{me.email}</p>
          <p className="mt-0.5 text-xs text-slate-500">{ROLE_LABELS[me.role]}</p>
          <div className="mt-3 flex gap-2">
            <Link to="/change-password" className="text-xs text-slate-400 hover:text-white">Change password</Link>
            <button onClick={logout} className={cn('ml-auto inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white')}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
