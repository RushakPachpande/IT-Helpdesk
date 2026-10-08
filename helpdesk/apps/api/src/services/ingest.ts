import {
  cleanEmailBody,
  CursorExpiredError,
  detectPriority,
  isAutoReply,
  isSelfSent,
  ReconnectRequiredError,
  senderDisplayName,
  type MailAdapter,
  type NormalizedMessage,
} from '@helpdesk/mail'
import { isEmailDomainAllowed, ticketNumberRegex, type Settings } from '@helpdesk/shared'
import pg from 'pg'
import { prisma, type Mailbox, type Ticket } from '../db.js'
import { config } from '../config.js'
import { getSettings } from './settings.js'
import { adapterFor, mailboxEvent, markReconnectRequired } from './mailboxes.js'
import { storeFile, detectMime, type StoredFile } from './storage.js'
import { addMessage, createTicket, defaultPriorityId, sendAckEmail } from './tickets.js'
import { publish } from './events.js'

const MAX_INBOUND_ATTACHMENT_BYTES = 25 * 1024 * 1024
const SYNC_LOCK_KEY = 74_201_001

/** Find an existing ticket for an inbound message: thread id, then [ticket number] in subject, then References. */
async function findTicket(mailbox: Mailbox, msg: NormalizedMessage, settings: Settings): Promise<Ticket | null> {
  if (msg.providerThreadId) {
    const link = await prisma.emailThreadLink.findUnique({
      where: { mailboxId_providerThreadId: { mailboxId: mailbox.id, providerThreadId: msg.providerThreadId } },
      include: { ticket: true },
    })
    if (link) return link.ticket
  }
  const m = ticketNumberRegex(settings.ticketId.format, settings.ticketId.prefix).exec(msg.subject)
  if (m) {
    const t = await prisma.ticket.findFirst({ where: { ticketNumber: { equals: m[1], mode: 'insensitive' } } })
    if (t) return t
  }
  const refs = [...msg.inReplyTo, ...msg.references]
  if (refs.length) {
    const out = await prisma.outboundEmail.findFirst({ where: { internetMessageId: { in: refs }, ticketId: { not: null } }, include: { ticket: true } })
    if (out?.ticket) return out.ticket
    const inb = await prisma.processedEmail.findFirst({ where: { internetMessageId: { in: refs }, ticketId: { not: null } } })
    if (inb?.ticketId) return prisma.ticket.findUnique({ where: { id: inb.ticketId } })
  }
  return null
}

async function storeInboundAttachments(adapter: MailAdapter, msg: NormalizedMessage, settings: Settings): Promise<StoredFile[]> {
  if (!msg.hasAttachments) return []
  const out: StoredFile[] = []
  for (const a of await adapter.getAttachments(msg.providerMessageId)) {
    if (a.inline && a.sizeBytes < settings.attachments.skipInlineImagesUnderKb * 1024) continue
    if (a.sizeBytes > MAX_INBOUND_ATTACHMENT_BYTES) continue
    const mime = await detectMime(a.content, a.mimeType)
    out.push(await storeFile(a.content, a.fileName, mime === 'application/octet-stream' ? a.mimeType : mime, a.inline))
  }
  return out
}

async function linkThread(mailbox: Mailbox, msg: NormalizedMessage, ticketId: string) {
  if (!msg.providerThreadId) return
  await prisma.emailThreadLink.upsert({
    where: { mailboxId_providerThreadId: { mailboxId: mailbox.id, providerThreadId: msg.providerThreadId } },
    create: { mailboxId: mailbox.id, providerThreadId: msg.providerThreadId, ticketId, lastProviderMessageId: msg.providerMessageId },
    update: { lastProviderMessageId: msg.providerMessageId },
  })
}

async function priorityIdFor(level: string): Promise<string | null> {
  const p = await prisma.priority.findFirst({ where: { name: { equals: level, mode: 'insensitive' }, active: true } })
  return p?.id ?? (await defaultPriorityId())
}

export type IngestOutcome = 'self' | 'auto-reply' | 'own-outbound' | 'appended' | 'created' | 'needs-review'

export async function processMessage(adapter: MailAdapter, mailbox: Mailbox, msg: NormalizedMessage, settings: Settings): Promise<{ outcome: IngestOutcome; ticketId: string | null }> {
  if (msg.sentByMailbox || isSelfSent(msg.fromEmail, mailbox.address)) return { outcome: 'self', ticketId: null }
  if (isAutoReply(msg.subject, msg.headers, settings.email.autoReplySubjectPrefixes)) return { outcome: 'auto-reply', ticketId: null }
  if (msg.internetMessageId) {
    const own = await prisma.outboundEmail.findFirst({ where: { internetMessageId: msg.internetMessageId } })
    if (own) return { outcome: 'own-outbound', ticketId: own.ticketId }
  }

  const body = cleanEmailBody({ html: msg.html, text: msg.text })
  const fromName = senderDisplayName(msg.fromName, msg.fromEmail)
  const rules = await prisma.allowedDomain.findMany()
  const domainAllowed = isEmailDomainAllowed(msg.fromEmail, rules)
  const knownUser = await prisma.user.findUnique({ where: { email: msg.fromEmail } })

  let ticket = await findTicket(mailbox, msg, settings)
  let followUpOf: Ticket | null = null
  if (ticket?.status === 'CLOSED' && ticket.closedAt && Date.now() - ticket.closedAt.getTime() > settings.email.reopenWindowDays * 86400_000) {
    followUpOf = ticket
    ticket = null
  }

  if (ticket) {
    const files = await storeInboundAttachments(adapter, msg, settings)
    const staffAuthor = knownUser && knownUser.role !== 'EMPLOYEE'
    await addMessage({
      ticketId: ticket.id,
      author: { id: knownUser?.id ?? null, name: knownUser?.name ?? fromName, email: msg.fromEmail, isStaff: Boolean(staffAuthor) },
      // Staff replying by email (e.g. to a notification) should not become visible to the requester by accident.
      kind: staffAuthor ? 'INTERNAL_NOTE' : 'PUBLIC',
      body,
      source: 'EMAIL',
      files,
      providerMessageId: msg.providerMessageId,
      internetMessageId: msg.internetMessageId,
    })
    await linkThread(mailbox, msg, ticket.id)
    return { outcome: 'appended', ticketId: ticket.id }
  }

  const files = await storeInboundAttachments(adapter, msg, settings)
  const other = await prisma.category.findFirst({ where: { name: { equals: 'Other', mode: 'insensitive' } } })
  let requesterId: string | null = null
  if (domainAllowed) {
    const user =
      knownUser ??
      (await prisma.user.create({
        data: { email: msg.fromEmail, name: fromName, role: 'EMPLOYEE', status: 'PLACEHOLDER', mustChangePassword: true },
      }))
    requesterId = user.id
  }
  const description = followUpOf ? `${body}\n\n(Follow-up to closed ticket ${followUpOf.ticketNumber})` : body
  const created = await createTicket({
    subject: msg.subject.trim() || '(no subject)',
    description,
    categoryId: other?.id ?? null,
    priorityId: await priorityIdFor(detectPriority(msg.subject, body)),
    requesterId,
    requesterEmail: msg.fromEmail,
    requesterName: knownUser?.name ?? fromName,
    ccEmails: msg.cc.filter((e) => e !== mailbox.address.toLowerCase()),
    source: 'EMAIL',
    status: domainAllowed ? 'NEW' : 'NEEDS_REVIEW',
    needsReviewReason: domainAllowed ? null : `Sender domain is not in the allowed list (${msg.fromEmail})`,
    files,
  })
  await linkThread(mailbox, msg, created.id)
  // The ProcessedEmail row must exist before the ack is sent so the reply can reference the original message.
  await prisma.processedEmail.create({
    data: {
      mailboxId: mailbox.id,
      providerMessageId: msg.providerMessageId,
      internetMessageId: msg.internetMessageId,
      outcome: domainAllowed ? 'created' : 'needs-review',
      ticketId: created.id,
    },
  })
  if (domainAllowed && settings.email.sendAck) await sendAckEmail(created)
  return { outcome: domainAllowed ? 'created' : 'needs-review', ticketId: created.id }
}

export async function processWithRetry(adapter: MailAdapter, mailbox: Mailbox, id: string, settings: Settings): Promise<void> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      // A failed attempt may already have recorded the message (e.g. ticket created, ack failed); never import twice.
      const done = await prisma.processedEmail.findUnique({ where: { mailboxId_providerMessageId: { mailboxId: mailbox.id, providerMessageId: id } } })
      if (done) return
      const msg = await adapter.getMessage(id)
      const result = await processMessage(adapter, mailbox, msg, settings)
      if (result.outcome !== 'created' && result.outcome !== 'needs-review') {
        await prisma.processedEmail.create({
          data: {
            mailboxId: mailbox.id,
            providerMessageId: id,
            internetMessageId: msg.internetMessageId,
            outcome: result.outcome,
            ticketId: result.ticketId,
          },
        })
      }
      return
    } catch (err) {
      if (err instanceof ReconnectRequiredError) throw err
      lastErr = err
      await new Promise((r) => setTimeout(r, attempt * 1000))
    }
  }
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr)
  await prisma.processedEmail
    .create({ data: { mailboxId: mailbox.id, providerMessageId: id, outcome: 'error' } })
    .catch(() => undefined)
  await mailboxEvent(mailbox.id, 'error', `Could not import message ${id}: ${message}. It is still in the mailbox.`)
}

/** One sync pass for the active mailbox. Guarded by an advisory lock so runs never overlap. */
export async function syncActiveMailbox(force = false): Promise<void> {
  const lockClient = new pg.Client({ connectionString: config.databaseUrl })
  await lockClient.connect()
  const locked = await lockClient.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [SYNC_LOCK_KEY])
  if (!locked.rows[0]?.ok) {
    await lockClient.end()
    return
  }
  try {
    const mailbox = await prisma.mailbox.findFirst({ where: { active: true }, orderBy: { updatedAt: 'desc' } })
    if (!mailbox || mailbox.status === 'RECONNECT_REQUIRED' || mailbox.status === 'DISCONNECTED') return
    const settings = await getSettings()
    if (!force && mailbox.lastSyncAt && Date.now() - mailbox.lastSyncAt.getTime() < settings.email.pollIntervalMinutes * 60_000 - 5_000) return

    const adapter = adapterFor(mailbox)
    let cursor = mailbox.syncCursor
    let since = mailbox.syncStartAt
    let batch
    try {
      batch = await adapter.listChanges(cursor, since)
    } catch (err) {
      if (!(err instanceof CursorExpiredError)) throw err
      await mailboxEvent(mailbox.id, 'warn', 'Sync cursor expired; resyncing recent mail')
      cursor = null
      since = new Date(Date.now() - Math.max(settings.email.initialLookbackMinutes, 60 * 24) * 60_000)
      batch = await adapter.listChanges(null, since)
    }

    let imported = 0
    for (const id of batch.messageIds) {
      const seen = await prisma.processedEmail.findUnique({
        where: { mailboxId_providerMessageId: { mailboxId: mailbox.id, providerMessageId: id } },
      })
      if (seen) continue
      await processWithRetry(adapter, mailbox, id, settings)
      imported++
    }
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: { syncCursor: batch.cursor, lastSyncAt: new Date(), status: 'CONNECTED', lastError: null },
    })
    if (imported > 0) await mailboxEvent(mailbox.id, 'info', `Processed ${imported} new message(s)`)
    await publish({ type: 'mailbox.changed' })
  } catch (err) {
    const mailbox = await prisma.mailbox.findFirst({ where: { active: true } })
    const message = err instanceof Error ? err.message : String(err)
    if (mailbox) {
      if (err instanceof ReconnectRequiredError) await markReconnectRequired(mailbox.id, message)
      else {
        await prisma.mailbox.update({ where: { id: mailbox.id }, data: { status: 'ERROR', lastError: message.slice(0, 1000), lastSyncAt: new Date() } })
        await mailboxEvent(mailbox.id, 'error', `Sync failed: ${message}`)
      }
    }
    throw err
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_KEY]).catch(() => undefined)
    await lockClient.end().catch(() => undefined)
  }
}
