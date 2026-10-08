import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bot, CheckCircle2, Lock, Mail, RotateCcw, Send, ShieldAlert, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { TICKET_STATUS_LABELS, TICKET_STATUSES, type TicketStatus } from '@helpdesk/shared'
import { api, ApiError, errorMessage } from '@/lib/api'
import { metaQuery, useIsStaff, useMe } from '@/lib/auth'
import type { Agent, TicketDetail, TicketMessage } from '@/lib/types'
import { cn, formatDateTime, timeAgo } from '@/lib/utils'
import { Alert, Badge, Button, Card, CardContent, CardHeader, EmptyState, Field, PageLoader, Select, Switch, Textarea } from '@/components/ui'
import { PriorityBadge, StatusBadge } from '@/components/badges'
import { FilePicker, filesValid } from '@/components/FilePicker'
import { AttachmentList } from '@/components/Attachments'

function useTicketMutation(ticketId: string) {
  const qc = useQueryClient()
  return (fn: () => Promise<unknown>, success?: string) => ({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      void qc.invalidateQueries({ queryKey: ['counts'] })
      if (success) toast.success(success)
    },
    onError: (e: unknown) => toast.error(errorMessage(e)),
  })
}

function MessageBubble({ m, attachments, mine }: { m: TicketMessage; attachments: TicketDetail['attachments']; mine: boolean }) {
  if (m.kind === 'SYSTEM') {
    return (
      <div className="flex items-center gap-3 py-1 text-xs text-slate-500">
        <div className="h-px flex-1 bg-slate-200" />
        <span>{m.bodyText} · {timeAgo(m.createdAt)}</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
    )
  }
  const internal = m.kind === 'INTERNAL_NOTE'
  const staffAuthor = m.author?.role === 'AGENT' || m.author?.role === 'ADMIN'
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg border px-4 py-3',
          internal ? 'border-amber-200 bg-amber-50' : mine ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white',
        )}
      >
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-800">{m.author?.name ?? m.authorName ?? m.authorEmail ?? 'Unknown'}</span>
          {staffAuthor && <Badge className="bg-slate-800 text-white">IT</Badge>}
          {internal && (
            <Badge className="bg-amber-200 text-amber-900">
              <Lock className="h-3 w-3" /> Internal note
            </Badge>
          )}
          {m.source === 'EMAIL' && (
            <span className="inline-flex items-center gap-1 text-slate-500"><Mail className="h-3 w-3" /> via email</span>
          )}
          <span className="text-slate-400" title={formatDateTime(m.createdAt)}>{timeAgo(m.createdAt)}</span>
        </div>
        <p className="whitespace-pre-wrap wrap-break-word text-sm text-slate-800">{m.bodyText}</p>
        <AttachmentList items={attachments.filter((a) => a.messageId === m.id)} />
      </div>
    </div>
  )
}

function Composer({ ticketId, staff, disabledReason }: { ticketId: string; staff: boolean; disabledReason?: string | null }) {
  const meta = useQuery(metaQuery)
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const mutation = useTicketMutation(ticketId)
  const send = useMutation(
    mutation(async () => {
      const fd = new FormData()
      fd.set('body', body)
      fd.set('kind', internal ? 'INTERNAL_NOTE' : 'PUBLIC')
      files.forEach((f) => fd.append('files', f, f.name))
      await api(`/api/tickets/${ticketId}/messages`, { form: fd })
      setBody('')
      setFiles([])
    }),
  )

  if (disabledReason) return <Alert variant="info">{disabledReason}</Alert>
  return (
    <div className={cn('rounded-lg border bg-white p-3', internal ? 'border-amber-300' : 'border-slate-200')}>
      {staff && (
        <div className="mb-2 flex gap-1">
          <button
            type="button"
            onClick={() => setInternal(false)}
            className={cn('rounded px-2.5 py-1 text-xs font-medium', !internal ? 'bg-blue-100 text-blue-800' : 'text-slate-500 hover:bg-slate-100')}
          >
            Reply to requester
          </button>
          <button
            type="button"
            onClick={() => setInternal(true)}
            className={cn('rounded px-2.5 py-1 text-xs font-medium', internal ? 'bg-amber-100 text-amber-900' : 'text-slate-500 hover:bg-slate-100')}
          >
            <Lock className="mr-1 inline h-3 w-3" /> Internal note
          </button>
        </div>
      )}
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={internal ? 'Only the IT team can see this note' : staff ? 'Reply to the requester (also sent by email)' : 'Write a message to IT'}
        className="border-0 px-1 focus:ring-0"
        rows={3}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && body.trim()) send.mutate()
        }}
      />
      <div className="mt-2 flex items-end justify-between gap-3">
        {meta.data && <FilePicker files={files} onChange={setFiles} limits={meta.data.attachments} compact />}
        <Button
          onClick={() => send.mutate()}
          loading={send.isPending}
          disabled={!body.trim() || (meta.data ? !filesValid(files, meta.data.attachments) : false)}
          variant={internal ? 'outline' : 'default'}
        >
          <Send className="h-4 w-4" /> {internal ? 'Add note' : 'Send'}
        </Button>
      </div>
    </div>
  )
}

function StaffPanel({ data }: { data: TicketDetail }) {
  const { ticket } = data
  const me = useMe()
  const meta = useQuery(metaQuery)
  const agents = useQuery({ queryKey: ['agents'], queryFn: () => api<{ agents: Agent[] }>('/api/agents'), staleTime: 60_000 })
  const [notes, setNotes] = useState(ticket.resolutionNotes ?? '')
  useEffect(() => {
    setNotes(ticket.resolutionNotes ?? '')
  }, [ticket.resolutionNotes])
  const mutation = useTicketMutation(ticket.id)
  const patch = useMutation({
    ...mutation(() => Promise.resolve()),
    mutationFn: (body: Record<string, unknown>) => api(`/api/tickets/${ticket.id}`, { method: 'PATCH', body }),
  })
  const done = ['RESOLVED', 'CLOSED'].includes(ticket.status)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Details" />
        <CardContent className="space-y-3">
          <Field label="Status">
            <Select
              value={ticket.status}
              disabled={ticket.status === 'NEEDS_REVIEW'}
              onChange={(e) => {
                const status = e.target.value as TicketStatus
                if ((status === 'RESOLVED' || status === 'CLOSED') && !notes.trim()) {
                  toast.error('Add resolution notes below first')
                  return
                }
                patch.mutate({ status, resolutionNotes: notes.trim() || undefined })
              }}
            >
              {TICKET_STATUSES.filter((s) => s !== 'NEEDS_REVIEW' || ticket.status === 'NEEDS_REVIEW').map((s) => (
                <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Assignee">
            <div className="flex gap-2">
              <Select value={ticket.assignee?.id ?? ''} onChange={(e) => patch.mutate({ assigneeId: e.target.value || null })}>
                <option value="">Unassigned</option>
                {agents.data?.agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
              {ticket.assignee?.id !== me.id && (
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Assign to me" onClick={() => patch.mutate({ assigneeId: me.id })}>
                  <UserPlus className="h-4 w-4" />
                </Button>
              )}
            </div>
          </Field>
          <Field label="Priority">
            <Select value={ticket.priority?.id ?? ''} onChange={(e) => patch.mutate({ priorityId: e.target.value })}>
              {meta.data?.priorities.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{!p.active ? ' (inactive)' : ''}</option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={ticket.category?.id ?? ''} onChange={(e) => patch.mutate({ categoryId: e.target.value })}>
              {!ticket.category && <option value="">Uncategorised</option>}
              {meta.data?.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{!c.active ? ' (inactive)' : ''}</option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      {ticket.status !== 'NEEDS_REVIEW' && (
        <Card>
          <CardHeader title="Resolution" />
          <CardContent className="space-y-3">
            <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What fixed the issue? Shared with the requester." />
            {!done ? (
              <div className="flex gap-2">
                <Button
                  variant="success"
                  className="flex-1"
                  disabled={!notes.trim()}
                  loading={patch.isPending}
                  onClick={() => patch.mutate({ status: 'RESOLVED', resolutionNotes: notes.trim() })}
                >
                  <CheckCircle2 className="h-4 w-4" /> Resolve
                </Button>
                <Button variant="outline" disabled={!notes.trim()} onClick={() => patch.mutate({ status: 'CLOSED', resolutionNotes: notes.trim() })}>
                  Close
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                {notes !== (ticket.resolutionNotes ?? '') && (
                  <Button size="sm" variant="outline" onClick={() => patch.mutate({ resolutionNotes: notes.trim() })}>Save notes</Button>
                )}
                {ticket.status === 'RESOLVED' && (
                  <Button size="sm" variant="outline" onClick={() => patch.mutate({ status: 'CLOSED' })}>Close now</Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => patch.mutate({ status: 'OPEN' })}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reopen
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.outbound.length > 0 && (
        <Card>
          <CardHeader title="Emails" description="Delivery log for this ticket" />
          <CardContent className="space-y-2 text-xs">
            {data.outbound.map((o) => (
              <div key={o.id} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium capitalize text-slate-700">{o.kind.replace('_', ' ')}</p>
                  <p className="truncate text-slate-500">{o.toEmails.join(', ')}</p>
                  {o.lastError && <p className="text-amber-700">{o.lastError}</p>}
                </div>
                <Badge
                  className={cn(
                    o.status === 'SENT' && 'bg-emerald-100 text-emerald-800',
                    o.status === 'QUEUED' && 'bg-blue-100 text-blue-800',
                    o.status === 'FAILED' && 'bg-red-100 text-red-800',
                    o.status === 'SUPPRESSED' && 'bg-slate-200 text-slate-700',
                  )}
                >
                  {o.status.toLowerCase()}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ReviewBanner({ data }: { data: TicketDetail }) {
  const [sendAck, setSendAck] = useState(false)
  const mutation = useTicketMutation(data.ticket.id)
  const review = useMutation({
    ...mutation(() => Promise.resolve()),
    mutationFn: (decision: 'accept' | 'discard') => api(`/api/tickets/${data.ticket.id}/review`, { body: { decision, sendAck } }),
  })
  return (
    <Alert variant="warn" className="mb-4">
      <div className="flex flex-wrap items-center gap-4">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Needs review</p>
          <p className="text-xs">{data.ticket.needsReviewReason ?? 'This request needs a decision before work starts.'}</p>
        </div>
        <Switch checked={sendAck} onChange={setSendAck} label="Send acknowledgement email" />
        <Button size="sm" variant="success" onClick={() => review.mutate('accept')} loading={review.isPending}>Accept as ticket</Button>
        <Button size="sm" variant="outline" onClick={() => review.mutate('discard')}>Discard</Button>
      </div>
    </Alert>
  )
}

function RequesterActions({ data }: { data: TicketDetail }) {
  const { ticket } = data
  const mutation = useTicketMutation(ticket.id)
  const confirm = useMutation(mutation(() => api(`/api/tickets/${ticket.id}/confirm`, { method: 'POST' }), 'Thanks! The request is closed.'))
  const reopen = useMutation(mutation(() => api(`/api/tickets/${ticket.id}/reopen`, { method: 'POST' }), 'Request reopened'))
  if (ticket.status === 'RESOLVED') {
    return (
      <Alert variant="success" className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <CheckCircle2 className="h-5 w-5" />
          <div className="flex-1">
            <p className="font-medium">IT marked this as resolved</p>
            {ticket.resolutionNotes && <p className="text-xs">{ticket.resolutionNotes}</p>}
          </div>
          <Button size="sm" variant="success" onClick={() => confirm.mutate()} loading={confirm.isPending}>Yes, it is fixed</Button>
          <Button size="sm" variant="outline" onClick={() => reopen.mutate()} loading={reopen.isPending}>Still a problem</Button>
        </div>
      </Alert>
    )
  }
  if (ticket.status === 'CLOSED') {
    return (
      <Alert variant="info" className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <p className="font-medium">This request is closed</p>
            {ticket.resolutionNotes && <p className="text-xs">Resolution: {ticket.resolutionNotes}</p>}
          </div>
          {data.canReopen && (
            <Button size="sm" variant="outline" onClick={() => reopen.mutate()} loading={reopen.isPending}>
              <RotateCcw className="h-3.5 w-3.5" /> Reopen
            </Button>
          )}
        </div>
      </Alert>
    )
  }
  return null
}

export function TicketDetailPage() {
  const { ticketId } = useParams({ from: '/app/tickets/$ticketId' })
  const me = useMe()
  const staff = useIsStaff()
  const q = useQuery({ queryKey: ['ticket', ticketId], queryFn: () => api<TicketDetail>(`/api/tickets/${ticketId}`) })
  const endRef = useRef<HTMLDivElement>(null)
  const count = q.data?.messages.length ?? 0
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [count])

  if (q.isLoading) return <PageLoader />
  if (q.error || !q.data) {
    return <EmptyState title={q.error instanceof ApiError && q.error.status === 403 ? 'You do not have access to this ticket' : 'Ticket not found'} />
  }
  const data = q.data
  const { ticket } = data
  const descriptionFiles = data.attachments.filter((a) => !a.messageId)
  const composerDisabled =
    !staff && ticket.status === 'CLOSED'
      ? 'This request is closed. Reopen it to continue the conversation.'
      : staff && ticket.status === 'NEEDS_REVIEW'
        ? 'Accept this request before replying. You can still add internal notes after accepting.'
        : null

  return (
    <div>
      <Link to={staff ? '/queue' : '/tickets'} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-sm text-slate-500">{ticket.ticketNumber}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{ticket.subject}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {ticket.requesterName} &lt;{ticket.requesterEmail}&gt; · opened {formatDateTime(ticket.createdAt)}
            {ticket.source === 'EMAIL' && ' · by email'}
            {ticket.requester?.status === 'PLACEHOLDER' && staff && ' · no app account yet'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PriorityBadge priority={ticket.priority} />
          <StatusBadge status={ticket.status} />
        </div>
      </div>

      {staff && ticket.status === 'NEEDS_REVIEW' && <ReviewBanner data={data} />}
      {!staff && <RequesterActions data={data} />}

      <div className={cn('grid gap-6', staff && 'lg:grid-cols-[1fr_300px]')}>
        <div className="min-w-0 space-y-4">
          {staff && ticket.aiSummary && (
            <div className="flex gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900">
              <Bot className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p>{ticket.aiSummary}</p>
                {ticket.aiPriority && <p className="mt-1 text-xs text-violet-700">Suggested priority: {ticket.aiPriority}</p>}
              </div>
            </div>
          )}
          <Card>
            <CardContent>
              <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>Type: <strong className="text-slate-700">{ticket.category?.name ?? 'Uncategorised'}</strong></span>
                <span>Assigned: <strong className="text-slate-700">{ticket.assignee?.name ?? 'Not yet'}</strong></span>
                {ticket.ccEmails.length > 0 && <span>CC: {ticket.ccEmails.join(', ')}</span>}
              </div>
              <p className="whitespace-pre-wrap wrap-break-word text-sm text-slate-800">{ticket.description}</p>
              <AttachmentList items={descriptionFiles} />
            </CardContent>
          </Card>

          <div className="space-y-3">
            {data.messages.map((m) => (
              <MessageBubble key={m.id} m={m} attachments={data.attachments} mine={m.authorId === me.id} />
            ))}
            <div ref={endRef} />
          </div>

          <Composer ticketId={ticket.id} staff={staff} disabledReason={composerDisabled} />
        </div>
        {staff && <StaffPanel data={data} />}
      </div>
    </div>
  )
}
