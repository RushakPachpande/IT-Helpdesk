import { TICKET_STATUS_LABELS, type TicketStatus } from '@helpdesk/shared'
import { Badge } from './ui'

const STATUS_STYLES: Record<TicketStatus, string> = {
  NEEDS_REVIEW: 'bg-amber-100 text-amber-800',
  NEW: 'bg-blue-100 text-blue-800',
  OPEN: 'bg-sky-100 text-sky-800',
  IN_PROGRESS: 'bg-violet-100 text-violet-800',
  WAITING_ON_REQUESTER: 'bg-orange-100 text-orange-800',
  RESOLVED: 'bg-emerald-100 text-emerald-800',
  CLOSED: 'bg-slate-200 text-slate-700',
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge className={STATUS_STYLES[status]}>{TICKET_STATUS_LABELS[status]}</Badge>
}

export function PriorityBadge({ priority }: { priority: { name: string; color: string } | null }) {
  if (!priority) return <span className="text-xs text-slate-400">-</span>
  return (
    <Badge className="border bg-white" style={{ borderColor: `${priority.color}55`, color: priority.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: priority.color }} />
      {priority.name}
    </Badge>
  )
}
