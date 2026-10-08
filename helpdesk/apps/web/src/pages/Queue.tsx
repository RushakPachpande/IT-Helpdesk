import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Inbox, Mail, Search } from 'lucide-react'
import { TICKET_STATUS_LABELS, TICKET_STATUSES } from '@helpdesk/shared'
import { api } from '@/lib/api'
import { metaQuery, useMe } from '@/lib/auth'
import type { Agent, TicketSummary } from '@/lib/types'
import { cn, timeAgo } from '@/lib/utils'
import { Button, Card, EmptyState, Input, PageHeader, PageLoader, Select, Table, Td, Th } from '@/components/ui'
import { PriorityBadge, StatusBadge } from '@/components/badges'

type View = { id: string; label: string; status: string; assignee?: string }

const VIEWS: View[] = [
  { id: 'active', label: 'All active', status: 'active' },
  { id: 'mine', label: 'Assigned to me', status: 'active', assignee: 'me' },
  { id: 'unassigned', label: 'Unassigned', status: 'active', assignee: 'unassigned' },
  { id: 'done', label: 'Resolved & closed', status: 'done' },
  { id: 'all', label: 'Everything', status: 'all' },
]

export function QueuePage({ reviewOnly = false }: { reviewOnly?: boolean }) {
  const me = useMe()
  const meta = useQuery(metaQuery)
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api<{ agents: Agent[] }>('/api/agents'), staleTime: 60_000 })
  const [view, setView] = useState<View>(VIEWS[0])
  const [status, setStatus] = useState('')
  const [assignee, setAssignee] = useState('')
  const [priorityId, setPriorityId] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)

  const params = new URLSearchParams({ page: String(page), pageSize: '25' })
  params.set('status', reviewOnly ? 'NEEDS_REVIEW' : status || view.status)
  const effectiveAssignee = assignee || view.assignee
  if (effectiveAssignee && !reviewOnly) params.set('assignee', effectiveAssignee)
  if (priorityId) params.set('priorityId', priorityId)
  if (q.trim()) params.set('q', q.trim())

  const list = useQuery({
    queryKey: ['tickets', 'queue', params.toString()],
    queryFn: () => api<{ tickets: TicketSummary[]; total: number; page: number; pageSize: number }>(`/api/tickets?${params}`),
    placeholderData: keepPreviousData,
  })
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1
  const reset = () => setPage(1)

  return (
    <div>
      <PageHeader
        title={reviewOnly ? 'Needs review' : 'Ticket queue'}
        description={reviewOnly ? 'Emails from senders outside the allowed domains. Accept them as tickets or discard them.' : `Signed in as ${me.name}`}
      />
      {!reviewOnly && (
        <div className="mb-4 flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                setView(v)
                setStatus('')
                setAssignee('')
                reset()
              }}
              className={cn(
                'rounded-full px-3 py-1.5 text-sm font-medium',
                view.id === v.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="relative min-w-55 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              className="pl-8"
              placeholder="Search ticket number, subject or requester"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                reset()
              }}
            />
          </div>
          {!reviewOnly && (
            <>
              <Select className="w-44" value={status} onChange={(e) => (setStatus(e.target.value), reset())} aria-label="Status filter">
                <option value="">Any status in view</option>
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>
                ))}
              </Select>
              <Select className="w-44" value={assignee} onChange={(e) => (setAssignee(e.target.value), reset())} aria-label="Assignee filter">
                <option value="">Any assignee in view</option>
                <option value="unassigned">Unassigned</option>
                {agents.data?.agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
              <Select className="w-36" value={priorityId} onChange={(e) => (setPriorityId(e.target.value), reset())} aria-label="Priority filter">
                <option value="">Any priority</option>
                {meta.data?.priorities.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </>
          )}
        </div>
        {list.isLoading ? (
          <PageLoader />
        ) : !list.data?.tickets.length ? (
          <EmptyState icon={<Inbox className="h-10 w-10" />} title={reviewOnly ? 'Nothing waiting for review' : 'No tickets match'} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Ticket</Th>
                  <Th>Requester</Th>
                  <Th>Status</Th>
                  <Th>Priority</Th>
                  <Th>Assignee</Th>
                  <Th>Activity</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <Td className="max-w-85">
                      <Link to="/tickets/$ticketId" params={{ ticketId: t.id }} className="block">
                        <span className="flex items-center gap-1.5 font-mono text-xs text-slate-500">
                          {t.ticketNumber}
                          {t.source === 'EMAIL' && <Mail className="h-3 w-3" aria-label="Email" />}
                        </span>
                        <span className="block truncate font-medium text-slate-900 hover:text-blue-700">{t.subject}</span>
                        <span className="text-xs text-slate-500">{t.category?.name ?? 'Uncategorised'}</span>
                      </Link>
                    </Td>
                    <Td>
                      <p className="text-sm">{t.requesterName}</p>
                      <p className="text-xs text-slate-500">{t.requesterEmail}</p>
                    </Td>
                    <Td><StatusBadge status={t.status} /></Td>
                    <Td><PriorityBadge priority={t.priority} /></Td>
                    <Td className="text-sm">{t.assignee?.name ?? <span className="text-slate-400">Unassigned</span>}</Td>
                    <Td className="whitespace-nowrap text-xs text-slate-500">{timeAgo(t.lastActivityAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-between px-4 py-3 text-sm text-slate-500">
              <span>{list.data.total} ticket(s)</span>
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span>Page {page} of {totalPages}</span>
                <Button size="icon" variant="outline" disabled={page >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
