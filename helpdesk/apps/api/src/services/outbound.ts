import { baseSubject, textToEmailHtml } from '@helpdesk/mail'
import { prisma, type Mailbox, type Ticket } from '../db.js'
import { config } from '../config.js'
import { enqueue, QUEUES } from './boss.js'

/** Outbound kinds that belong to the requester's email thread (and update thread links when sent). */
export const THREAD_KINDS = new Set(['ack', 'web_created', 'reply', 'resolved', 'closed'])

export function activeMailbox(): Promise<Mailbox | null> {
  return prisma.mailbox.findFirst({ where: { active: true }, orderBy: { updatedAt: 'desc' } })
}

export function ticketUrl(ticket: Pick<Ticket, 'id'>): string {
  return `${config.publicUrl}/tickets/${ticket.id}`
}

export function ticketSubject(ticket: Pick<Ticket, 'ticketNumber' | 'subject'>, reply = false): string {
  const subject = baseSubject(ticket.subject).replace(/\[[^\]]*\]\s*/g, '').trim() || '(no subject)'
  return `${reply ? 'RE: ' : ''}[${ticket.ticketNumber}] ${subject}`
}

export interface QueueEmailInput {
  ticketId: string | null
  kind: string
  to: string[]
  cc?: string[]
  subject: string
  bodyText: string
  attachmentIds?: string[]
  messageId?: string | null
}

export async function queueEmail(input: QueueEmailInput): Promise<void> {
  const mailbox = await activeMailbox()
  const self = mailbox?.address.toLowerCase()
  const clean = (list: string[] = []) =>
    [...new Set(list.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@') && e !== self))]
  const to = clean(input.to)
  if (to.length === 0) return
  const cc = clean(input.cc).filter((e) => !to.includes(e))

  let status: 'QUEUED' | 'SUPPRESSED' = 'QUEUED'
  let lastError: string | null = null
  if (!mailbox || mailbox.status === 'DISCONNECTED') {
    status = 'SUPPRESSED'
    lastError = 'No support mailbox connected'
  } else if (mailbox.shadowMode) {
    status = 'SUPPRESSED'
    lastError = 'Shadow mode is on: email not sent'
  }

  const row = await prisma.outboundEmail.create({
    data: {
      mailboxId: mailbox?.id ?? null,
      ticketId: input.ticketId,
      messageId: input.messageId ?? null,
      kind: input.kind,
      toEmails: to,
      ccEmails: cc,
      subject: input.subject,
      bodyHtml: textToEmailHtml(input.bodyText),
      attachmentIds: input.attachmentIds ?? [],
      status,
      lastError,
    },
  })
  if (status === 'QUEUED') await enqueue(QUEUES.mailSend, { outboundId: row.id })
}
