import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  ACTIVE_STATUSES,
  createTicketFieldsSchema,
  isStaff,
  messageFieldsSchema,
  reviewDecisionSchema,
  ticketListQuerySchema,
  TICKET_STATUSES,
  updateTicketSchema,
  type TicketStatus,
} from '@helpdesk/shared'
import { prisma, type Prisma } from '../db.js'
import { badRequest, forbidden, notFound, parse } from '../http.js'
import { requireAuth, requireStaff } from '../auth/session.js'
import { getSettings } from '../services/settings.js'
import { INLINE_SAFE_TYPES, openStoredFile, storeUpload, type StoredFile } from '../services/storage.js'
import {
  addMessage,
  assertCanView,
  canRequesterReopen,
  createTicket,
  sendAckEmail,
  sendWebCreatedEmail,
  ticketListInclude,
  updateTicket,
} from '../services/tickets.js'

/** Read a multipart request: text fields plus validated, stored files. */
async function readMultipart(req: FastifyRequest): Promise<{ fields: Record<string, string>; files: StoredFile[] }> {
  const settings = await getSettings()
  const fields: Record<string, string> = {}
  const files: StoredFile[] = []
  if (!req.isMultipart()) {
    return { fields: (req.body as Record<string, string>) ?? {}, files }
  }
  const maxBytes = settings.attachments.maxFileMb * 1024 * 1024
  for await (const part of req.parts({ limits: { fileSize: maxBytes, files: settings.attachments.maxFilesPerMessage } })) {
    if (part.type === 'file') {
      if (!part.filename) {
        await part.toBuffer()
        continue
      }
      let buf: Buffer
      try {
        buf = await part.toBuffer()
      } catch {
        throw badRequest(`${part.filename} is larger than ${settings.attachments.maxFileMb} MB`)
      }
      files.push(await storeUpload(buf, part.filename, part.mimetype, settings.attachments.allowedMimeTypes))
    } else {
      fields[part.fieldname] = String(part.value ?? '')
    }
  }
  return { fields, files }
}

function authorOf(user: { id: string; name: string; email: string; role: string }) {
  return { id: user.id, name: user.name, email: user.email, isStaff: isStaff(user.role as never) }
}

export async function ticketRoutes(app: FastifyInstance) {
  app.get('/api/tickets', async (req) => {
    const user = requireAuth(req)
    const q = parse(ticketListQuerySchema, req.query)
    const where: Prisma.TicketWhereInput = {}
    if (!isStaff(user.role)) {
      where.requesterId = user.id
      if (q.status === 'active') where.status = { in: [...ACTIVE_STATUSES, 'NEEDS_REVIEW'] }
      else if (q.status === 'done') where.status = { in: ['RESOLVED', 'CLOSED'] }
    } else {
      if (!q.status || q.status === 'active') where.status = { in: ACTIVE_STATUSES }
      else if (q.status === 'done') where.status = { in: ['RESOLVED', 'CLOSED'] }
      else if (q.status !== 'all') {
        if (!TICKET_STATUSES.includes(q.status as TicketStatus)) throw badRequest('Unknown status')
        where.status = q.status as TicketStatus
      }
      if (q.assignee === 'me') where.assigneeId = user.id
      else if (q.assignee === 'unassigned') where.assigneeId = null
      else if (q.assignee) where.assigneeId = q.assignee
      if (q.priorityId) where.priorityId = q.priorityId
    }
    if (q.q) {
      where.OR = [
        { ticketNumber: { contains: q.q, mode: 'insensitive' } },
        { subject: { contains: q.q, mode: 'insensitive' } },
        { requesterEmail: { contains: q.q, mode: 'insensitive' } },
        { requesterName: { contains: q.q, mode: 'insensitive' } },
      ]
    }
    const [total, tickets] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        include: ticketListInclude,
        orderBy: [{ lastActivityAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ])
    return { tickets, total, page: q.page, pageSize: q.pageSize }
  })

  app.get('/api/tickets/counts', { preHandler: requireStaff }, async (req) => {
    const user = requireAuth(req)
    const [needsReview, unassigned, mine, active] = await Promise.all([
      prisma.ticket.count({ where: { status: 'NEEDS_REVIEW' } }),
      prisma.ticket.count({ where: { status: { in: ACTIVE_STATUSES }, assigneeId: null } }),
      prisma.ticket.count({ where: { status: { in: ACTIVE_STATUSES }, assigneeId: user.id } }),
      prisma.ticket.count({ where: { status: { in: ACTIVE_STATUSES } } }),
    ])
    return { needsReview, unassigned, mine, active }
  })

  app.post('/api/tickets', async (req) => {
    const user = requireAuth(req)
    const { fields, files } = await readMultipart(req)
    const body = parse(createTicketFieldsSchema, fields)
    const [category, priority] = await Promise.all([
      prisma.category.findFirst({ where: { id: body.categoryId, active: true } }),
      prisma.priority.findFirst({ where: { id: body.priorityId, active: true } }),
    ])
    if (!category) throw badRequest('Choose a valid category')
    if (!priority) throw badRequest('Choose a valid priority')
    const ticket = await createTicket({
      subject: body.subject,
      description: body.description,
      categoryId: category.id,
      priorityId: priority.id,
      requesterId: user.id,
      requesterEmail: user.email,
      requesterName: user.name,
      source: 'WEB',
      files,
      actorId: user.id,
    })
    await sendWebCreatedEmail({ ...ticket, priority })
    return { ticket }
  })

  app.get('/api/tickets/:id', async (req) => {
    const user = requireAuth(req)
    const { id } = req.params as { id: string }
    const ticket = await prisma.ticket.findUnique({ where: { id }, include: ticketListInclude })
    if (!ticket) throw notFound('Ticket not found')
    assertCanView(user, ticket)
    const staff = isStaff(user.role)
    const [messages, attachments, outbound] = await Promise.all([
      prisma.ticketMessage.findMany({
        where: { ticketId: id, ...(staff ? {} : { kind: { not: 'INTERNAL_NOTE' } }) },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, role: true } } },
      }),
      prisma.attachment.findMany({
        where: { ticketId: id, ...(staff ? {} : { OR: [{ messageId: null }, { message: { kind: { not: 'INTERNAL_NOTE' } } }] }) },
        orderBy: { createdAt: 'asc' },
        select: { id: true, messageId: true, fileName: true, mimeType: true, sizeBytes: true, inline: true, createdAt: true },
      }),
      staff
        ? prisma.outboundEmail.findMany({
            where: { ticketId: id },
            orderBy: { createdAt: 'asc' },
            select: { id: true, kind: true, status: true, toEmails: true, lastError: true, sentAt: true, createdAt: true, messageId: true },
          })
        : Promise.resolve([]),
    ])
    return { ticket, messages, attachments, outbound, canReopen: await canRequesterReopen(ticket) }
  })

  app.patch('/api/tickets/:id', { preHandler: requireStaff }, async (req) => {
    const user = requireAuth(req)
    const { id } = req.params as { id: string }
    const body = parse(updateTicketSchema, req.body)
    const current = await prisma.ticket.findUnique({ where: { id } })
    if (!current) throw notFound('Ticket not found')
    if (body.status && ['RESOLVED', 'CLOSED'].includes(body.status) && !(body.resolutionNotes ?? current.resolutionNotes)?.trim()) {
      throw badRequest('Add resolution notes before resolving or closing the ticket', 'RESOLUTION_REQUIRED')
    }
    if (body.status === 'NEEDS_REVIEW') throw badRequest('Use the review actions for Needs Review tickets')
    const ticket = await updateTicket(id, body, user)
    return { ticket }
  })

  app.post('/api/tickets/:id/messages', async (req) => {
    const user = requireAuth(req)
    const { id } = req.params as { id: string }
    const ticket = await prisma.ticket.findUnique({ where: { id } })
    if (!ticket) throw notFound('Ticket not found')
    assertCanView(user, ticket)
    const { fields, files } = await readMultipart(req)
    const body = parse(messageFieldsSchema, fields)
    const staff = isStaff(user.role)
    if (!staff && body.kind !== 'PUBLIC') throw forbidden()
    if (!staff && ticket.status === 'CLOSED') {
      throw badRequest('This ticket is closed. Reopen it to continue the conversation.', 'TICKET_CLOSED')
    }
    if (staff && ticket.status === 'NEEDS_REVIEW' && body.kind === 'PUBLIC') {
      throw badRequest('Accept this ticket from the review queue before replying to the sender')
    }
    const message = await addMessage({
      ticketId: id,
      author: authorOf(user),
      kind: body.kind,
      body: body.body,
      source: 'WEB',
      files,
    })
    return { message }
  })

  app.post('/api/tickets/:id/confirm', async (req) => {
    const user = requireAuth(req)
    const { id } = req.params as { id: string }
    const ticket = await prisma.ticket.findUnique({ where: { id } })
    assertCanView(user, ticket)
    if (ticket.requesterId !== user.id) throw forbidden('Only the requester can confirm the resolution')
    if (ticket.status !== 'RESOLVED') throw badRequest('Only resolved tickets can be confirmed')
    const updated = await updateTicket(id, { status: 'CLOSED' }, user, { notify: false })
    return { ticket: updated }
  })

  app.post('/api/tickets/:id/reopen', async (req) => {
    const user = requireAuth(req)
    const { id } = req.params as { id: string }
    const ticket = await prisma.ticket.findUnique({ where: { id } })
    assertCanView(user, ticket)
    if (!isStaff(user.role) && !(await canRequesterReopen(ticket))) {
      throw badRequest('This ticket can no longer be reopened. Please create a new ticket.')
    }
    if (!['RESOLVED', 'CLOSED'].includes(ticket.status)) throw badRequest('Ticket is not resolved or closed')
    const updated = await updateTicket(id, { status: 'OPEN' }, user, { notify: false })
    return { ticket: updated }
  })

  app.post('/api/tickets/:id/review', { preHandler: requireStaff }, async (req) => {
    const user = requireAuth(req)
    const { id } = req.params as { id: string }
    const body = parse(reviewDecisionSchema, req.body)
    const ticket = await prisma.ticket.findUnique({ where: { id }, include: { priority: true } })
    if (!ticket) throw notFound('Ticket not found')
    if (ticket.status !== 'NEEDS_REVIEW') throw badRequest('Ticket is not waiting for review')
    if (body.decision === 'discard') {
      const updated = await updateTicket(id, { status: 'CLOSED', resolutionNotes: 'Discarded during review' }, user, { notify: false })
      return { ticket: updated }
    }
    const updated = await updateTicket(id, { status: 'NEW' }, user, { notify: false })
    if (body.sendAck) await sendAckEmail(ticket)
    return { ticket: updated }
  })

  app.get('/api/attachments/:id', async (req, reply) => {
    const user = requireAuth(req)
    const { id } = req.params as { id: string }
    const att = await prisma.attachment.findUnique({
      where: { id },
      include: { ticket: { select: { requesterId: true } }, message: { select: { kind: true } } },
    })
    if (!att) throw notFound('Attachment not found')
    assertCanView(user, att.ticket)
    if (!isStaff(user.role) && att.message?.kind === 'INTERNAL_NOTE') throw forbidden()
    const inline = INLINE_SAFE_TYPES.has(att.mimeType) && (req.query as { download?: string }).download === undefined
    const encoded = encodeURIComponent(att.fileName)
    reply
      .header('Content-Type', INLINE_SAFE_TYPES.has(att.mimeType) ? att.mimeType : 'application/octet-stream')
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`)
      .header('Cache-Control', 'private, max-age=3600')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
    return reply.send(openStoredFile(att.storagePath))
  })
}
