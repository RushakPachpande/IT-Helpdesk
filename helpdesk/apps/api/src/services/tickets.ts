import { renderTemplate, TICKET_STATUS_LABELS, type TicketStatus } from '@helpdesk/shared'
import { prisma, type Prisma, type Ticket } from '../db.js'
import { forbidden } from '../http.js'
import type { SessionUser } from '../auth/session.js'
import { getSettings } from './settings.js'
import { nextTicketNumber } from './ticketNumber.js'
import { publish } from './events.js'
import { queueEmail, ticketSubject, ticketUrl } from './outbound.js'
import { enqueue, QUEUES } from './boss.js'
import type { StoredFile } from './storage.js'

export const ticketListInclude = {
  category: { select: { id: true, name: true } },
  priority: { select: { id: true, name: true, color: true, rank: true } },
  assignee: { select: { id: true, name: true, email: true } },
  requester: { select: { id: true, name: true, email: true, status: true } },
} satisfies Prisma.TicketInclude

export function canViewTicket(user: SessionUser, ticket: Pick<Ticket, 'requesterId'>): boolean {
  return user.role !== 'EMPLOYEE' || ticket.requesterId === user.id
}

export function assertCanView(user: SessionUser, ticket: Pick<Ticket, 'requesterId'> | null): asserts ticket {
  if (!ticket || !canViewTicket(user, ticket)) throw forbidden('You do not have access to this ticket')
}

async function emitTicket(ticket: Pick<Ticket, 'id' | 'requesterId'>, type: 'ticket.changed' | 'ticket.message', staffOnly = false) {
  await publish({ type, ticketId: ticket.id, requesterId: ticket.requesterId, staffOnly })
}

async function systemMessage(ticketId: string, text: string, actorId: string | null) {
  await prisma.ticketMessage.create({
    data: { ticketId, kind: 'SYSTEM', bodyText: text, authorId: actorId },
  })
}

async function templateVars(ticket: Ticket & { priority?: { name: string } | null }, extra: Record<string, string | number | null> = {}) {
  const settings = await getSettings()
  return {
    requesterName: ticket.requesterName,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    priority: ticket.priority?.name ?? '',
    ticketUrl: ticketUrl(ticket),
    resolutionNotes: ticket.resolutionNotes ?? '',
    reopenWindowDays: settings.email.reopenWindowDays,
    ...extra,
  }
}

export async function defaultPriorityId(): Promise<string | null> {
  const p = (await prisma.priority.findFirst({ where: { isDefault: true } })) ?? (await prisma.priority.findFirst({ orderBy: { rank: 'asc' } }))
  return p?.id ?? null
}

function attachmentRows(files: StoredFile[], ticketId: string, messageId: string | null) {
  return files.map((f) => ({ ...f, ticketId, messageId }))
}

export interface CreateTicketInput {
  subject: string
  description: string
  categoryId: string | null
  priorityId: string | null
  requesterId: string | null
  requesterEmail: string
  requesterName: string
  ccEmails?: string[]
  source: 'WEB' | 'EMAIL'
  status?: TicketStatus
  needsReviewReason?: string | null
  files?: StoredFile[]
  actorId?: string | null
}

export async function createTicket(input: CreateTicketInput) {
  const ticketNumber = await nextTicketNumber()
  const ticket = await prisma.ticket.create({
    data: {
      ticketNumber,
      subject: input.subject,
      description: input.description,
      categoryId: input.categoryId,
      priorityId: input.priorityId ?? (await defaultPriorityId()),
      requesterId: input.requesterId,
      requesterEmail: input.requesterEmail.toLowerCase(),
      requesterName: input.requesterName,
      ccEmails: input.ccEmails ?? [],
      source: input.source,
      status: input.status ?? 'NEW',
      needsReviewReason: input.needsReviewReason ?? null,
      attachments: input.files?.length ? { createMany: { data: input.files.map((f) => ({ ...f })) } } : undefined,
    },
    include: ticketListInclude,
  })
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      action: 'ticket.created',
      entityType: 'ticket',
      entityId: ticket.id,
      details: { ticketNumber, source: input.source, status: ticket.status },
    },
  })
  const settings = await getSettings()
  if (settings.ai.enabled && settings.ai.apiKey) {
    await enqueue(QUEUES.aiSummarize, { ticketId: ticket.id }, { retryLimit: 2 }).catch(() => undefined)
  }
  await emitTicket(ticket, 'ticket.changed')
  return ticket
}

/** Confirmation email for tickets created in the web app; this starts the email thread. */
export async function sendWebCreatedEmail(ticket: Ticket & { priority?: { name: string } | null }) {
  const settings = await getSettings()
  if (!settings.email.sendAck) return
  const vars = await templateVars(ticket)
  await queueEmail({
    ticketId: ticket.id,
    kind: 'web_created',
    to: [ticket.requesterEmail],
    cc: ticket.ccEmails,
    subject: renderTemplate(settings.templates.webCreatedSubject, { ...vars, subject: ticketSubject(ticket).replace(/^\[[^\]]+\]\s*/, '') }),
    bodyText: renderTemplate(settings.templates.webCreatedBody, vars),
  })
}

export async function sendAckEmail(ticket: Ticket & { priority?: { name: string } | null }) {
  const settings = await getSettings()
  const vars = await templateVars(ticket)
  await queueEmail({
    ticketId: ticket.id,
    kind: 'ack',
    to: [ticket.requesterEmail],
    cc: ticket.ccEmails,
    subject: renderTemplate(settings.templates.ackSubject, { ...vars, subject: ticketSubject(ticket).replace(/^\[[^\]]+\]\s*/, '') }),
    bodyText: renderTemplate(settings.templates.ackBody, vars),
  })
}

export interface AddMessageInput {
  ticketId: string
  author: { id: string | null; name: string; email: string | null; isStaff: boolean }
  kind: 'PUBLIC' | 'INTERNAL_NOTE'
  body: string
  source: 'WEB' | 'EMAIL'
  files?: StoredFile[]
  providerMessageId?: string | null
  internetMessageId?: string | null
}

export async function addMessage(input: AddMessageInput) {
  const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: input.ticketId }, include: { priority: true, assignee: true } })
  const message = await prisma.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      authorId: input.author.id,
      authorName: input.author.name,
      authorEmail: input.author.email,
      kind: input.kind,
      source: input.source,
      bodyText: input.body,
      providerMessageId: input.providerMessageId ?? null,
      internetMessageId: input.internetMessageId ?? null,
    },
  })
  if (input.files?.length) {
    await prisma.attachment.createMany({ data: attachmentRows(input.files, ticket.id, message.id) })
  }

  // Status flow: a requester reply reopens waiting/resolved/closed tickets; the first agent reply opens a new one.
  let status = ticket.status
  if (input.kind === 'PUBLIC') {
    if (!input.author.isStaff && ['WAITING_ON_REQUESTER', 'RESOLVED', 'CLOSED'].includes(ticket.status)) status = 'OPEN'
    if (input.author.isStaff && ticket.status === 'NEW') status = 'OPEN'
  }
  await prisma.ticket.update({
    where: { id: ticket.id },
    data: {
      lastActivityAt: new Date(),
      status,
      ...(status !== ticket.status && ['RESOLVED', 'CLOSED'].includes(ticket.status) ? { resolvedAt: null, closedAt: null } : {}),
    },
  })
  if (status !== ticket.status) {
    await systemMessage(ticket.id, `Status changed from ${TICKET_STATUS_LABELS[ticket.status]} to ${TICKET_STATUS_LABELS[status]}`, null)
  }

  const settings = await getSettings()
  const vars = await templateVars(ticket)
  if (input.kind === 'PUBLIC' && input.author.isStaff && input.source === 'WEB' && settings.email.notifyRequesterOnReply) {
    await queueEmail({
      ticketId: ticket.id,
      kind: 'reply',
      messageId: message.id,
      to: [ticket.requesterEmail],
      cc: ticket.ccEmails,
      subject: ticketSubject(ticket, true),
      bodyText: renderTemplate(settings.templates.replyBody, { ...vars, message: input.body, agentName: input.author.name }),
      attachmentIds: [],
    })
    // Attachments are resolved by message id in the sender.
    if (input.files?.length) {
      const ids = (await prisma.attachment.findMany({ where: { messageId: message.id }, select: { id: true } })).map((a) => a.id)
      await prisma.outboundEmail.updateMany({ where: { messageId: message.id }, data: { attachmentIds: ids } })
    }
  }
  if (!input.author.isStaff && ticket.assignee && settings.email.notifyAgentOnRequesterReply && ticket.assignee.id !== input.author.id) {
    await queueEmail({
      ticketId: ticket.id,
      kind: 'agent_notify',
      to: [ticket.assignee.email],
      subject: `New reply on [${ticket.ticketNumber}] ${ticket.subject}`,
      bodyText: `${input.author.name} replied on ticket ${ticket.ticketNumber}:\n\n${input.body.slice(0, 1500)}\n\n${ticketUrl(ticket)}`,
    })
  }

  await emitTicket(ticket, 'ticket.message', input.kind === 'INTERNAL_NOTE')
  return message
}

export interface UpdateTicketInput {
  status?: TicketStatus
  priorityId?: string
  categoryId?: string
  assigneeId?: string | null
  resolutionNotes?: string
}

export async function updateTicket(ticketId: string, changes: UpdateTicketInput, actor: { id: string | null; name: string }, opts: { notify?: boolean } = {}) {
  const notify = opts.notify ?? true
  const before = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: { priority: true, category: true, assignee: true },
  })
  const data: Prisma.TicketUncheckedUpdateInput = { lastActivityAt: new Date() }
  const notes: string[] = []

  if (changes.status && changes.status !== before.status) {
    data.status = changes.status
    if (changes.status === 'RESOLVED') data.resolvedAt = new Date()
    if (changes.status === 'CLOSED') data.closedAt = new Date()
    if (!['RESOLVED', 'CLOSED'].includes(changes.status)) {
      data.resolvedAt = null
      data.closedAt = null
    }
    if (before.status === 'NEEDS_REVIEW') data.needsReviewReason = null
    notes.push(`Status changed from ${TICKET_STATUS_LABELS[before.status]} to ${TICKET_STATUS_LABELS[changes.status]}`)
  }
  if (changes.priorityId && changes.priorityId !== before.priorityId) {
    const p = await prisma.priority.findUniqueOrThrow({ where: { id: changes.priorityId } })
    data.priorityId = p.id
    notes.push(`Priority changed from ${before.priority?.name ?? 'none'} to ${p.name}`)
  }
  if (changes.categoryId && changes.categoryId !== before.categoryId) {
    const c = await prisma.category.findUniqueOrThrow({ where: { id: changes.categoryId } })
    data.categoryId = c.id
    notes.push(`Category changed from ${before.category?.name ?? 'none'} to ${c.name}`)
  }
  let newAssignee: { id: string; name: string; email: string } | null = null
  if (changes.assigneeId !== undefined && changes.assigneeId !== before.assigneeId) {
    if (changes.assigneeId) {
      newAssignee = await prisma.user.findFirstOrThrow({
        where: { id: changes.assigneeId, role: { in: ['AGENT', 'ADMIN'] }, status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
      })
      notes.push(`Assigned to ${newAssignee.name}`)
      if (before.status === 'NEW' && !changes.status) data.status = 'OPEN'
    } else {
      notes.push('Unassigned')
    }
    data.assigneeId = changes.assigneeId
  }
  if (changes.resolutionNotes !== undefined && changes.resolutionNotes !== before.resolutionNotes) {
    data.resolutionNotes = changes.resolutionNotes
  }

  const ticket = await prisma.ticket.update({ where: { id: ticketId }, data, include: ticketListInclude })
  for (const n of notes) await systemMessage(ticketId, `${n} by ${actor.name}`, actor.id)
  if (notes.length) {
    await prisma.auditLog.create({
      data: { actorId: actor.id, action: 'ticket.updated', entityType: 'ticket', entityId: ticketId, details: { changes: notes } },
    })
  }

  if (notify) {
    const settings = await getSettings()
    const full = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { priority: true } })
    const vars = await templateVars(full)
    if (newAssignee && settings.email.notifyAgentOnAssign && newAssignee.id !== actor.id) {
      await queueEmail({
        ticketId,
        kind: 'agent_notify',
        to: [newAssignee.email],
        subject: `Assigned: [${full.ticketNumber}] ${full.subject}`,
        bodyText: renderTemplate(settings.templates.assignedBody, vars),
      })
    }
    if (data.status && settings.email.notifyRequesterOnStatus && full.requesterEmail && before.status !== 'NEEDS_REVIEW') {
      const template = data.status === 'RESOLVED' ? settings.templates.resolvedBody : data.status === 'CLOSED' ? settings.templates.closedBody : null
      if (template) {
        await queueEmail({
          ticketId,
          kind: data.status === 'RESOLVED' ? 'resolved' : 'closed',
          to: [full.requesterEmail],
          cc: full.ccEmails,
          subject: ticketSubject(full, true),
          bodyText: renderTemplate(template, vars),
        })
      }
    }
  }

  await emitTicket(ticket, 'ticket.changed')
  return ticket
}

/** Requester may reopen a resolved/closed ticket within the configured window. */
export async function canRequesterReopen(ticket: Pick<Ticket, 'status' | 'resolvedAt' | 'closedAt'>): Promise<boolean> {
  if (!['RESOLVED', 'CLOSED'].includes(ticket.status)) return false
  const { email } = await getSettings()
  const at = ticket.closedAt ?? ticket.resolvedAt
  if (!at) return true
  return Date.now() - at.getTime() <= email.reopenWindowDays * 86400_000
}
