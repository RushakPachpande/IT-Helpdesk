import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Inbox, Mail, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import type { TicketSummary } from '@/lib/types'
import { cn, timeAgo } from '@/lib/utils'
import { Button, Card, EmptyState, PageHeader, PageLoader } from '@/components/ui'
import { PriorityBadge, StatusBadge } from '@/components/badges'

const TABS = [
  { id: 'active', label: 'Open' },
  { id: 'done', label: 'Resolved & closed' },
]

export function MyTicketsPage() {
  const [tab, setTab] = useState('active')
  const list = useQuery({
    queryKey: ['tickets', 'mine', tab],
    queryFn: () => api<{ tickets: TicketSummary[]; total: number }>(`/api/tickets?status=${tab}&pageSize=100`),
  })

  return (
    <div>
      <PageHeader
        title="My requests"
        description="Track your IT support requests and chat with the IT team."
        actions={
          <Link to="/tickets/new">
            <Button><Plus className="h-4 w-4" /> New request</Button>
          </Link>
        }
      />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Card>
        {list.isLoading ? (
          <PageLoader />
        ) : !list.data?.tickets.length ? (
          <EmptyState
            icon={<Inbox className="h-10 w-10" />}
            title={tab === 'active' ? 'No open requests' : 'Nothing here yet'}
            description="Raise a request and IT will get back to you here and by email."
            action={tab === 'active' && <Link to="/tickets/new"><Button size="sm">New request</Button></Link>}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.data.tickets.map((t) => (
              <li key={t.id}>
                <Link to="/tickets/$ticketId" params={{ ticketId: t.id }} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono">{t.ticketNumber}</span>
                      {t.source === 'EMAIL' && <Mail className="h-3 w-3" aria-label="Created by email" />}
                      <span>·</span>
                      <span>{t.category?.name ?? 'Uncategorised'}</span>
                    </div>
                    <p className="mt-0.5 truncate font-medium text-slate-900">{t.subject}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Updated {timeAgo(t.lastActivityAt)}
                      {t.assignee ? ` · Handled by ${t.assignee.name}` : ''}
                    </p>
                  </div>
                  <PriorityBadge priority={t.priority} />
                  <StatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
