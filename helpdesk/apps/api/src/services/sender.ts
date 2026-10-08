import { ReconnectRequiredError, type OutgoingAttachment, type ReplyContext } from '@helpdesk/mail'
import { prisma } from '../db.js'
import { adapterFor, mailboxEvent, markReconnectRequired } from './mailboxes.js'
import { readStoredFile } from './storage.js'
import { THREAD_KINDS } from './outbound.js'

/** Work out which message to answer so replies stay in the requester's thread. */
async function replyContextFor(ticketId: string, mailboxId: string): Promise<ReplyContext | undefined> {
  const link = await prisma.emailThreadLink.findFirst({
    where: { ticketId, mailboxId },
    orderBy: { createdAt: 'desc' },
  })
  const [inbound, outbound] = await Promise.all([
    prisma.processedEmail.findMany({
      where: { ticketId, mailboxId, internetMessageId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { internetMessageId: true, createdAt: true },
    }),
    prisma.outboundEmail.findMany({
      where: { ticketId, mailboxId, status: 'SENT', internetMessageId: { not: null }, kind: { in: [...THREAD_KINDS] } },
      orderBy: { sentAt: 'asc' },
      select: { internetMessageId: true, sentAt: true },
    }),
  ])
  const ids = [
    ...inbound.map((m) => ({ id: m.internetMessageId!, at: m.createdAt })),
    ...outbound.map((m) => ({ id: m.internetMessageId!, at: m.sentAt ?? new Date(0) })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime())
  if (!link && ids.length === 0) return undefined
  const last = ids.at(-1)?.id ?? null
  return {
    providerMessageId: link?.lastProviderMessageId ?? null,
    providerThreadId: link?.providerThreadId ?? null,
    internetMessageId: last,
    references: ids.map((x) => x.id).filter((id) => id !== last).slice(-19),
  }
}

export async function sendOutbound(outboundId: string): Promise<void> {
  const row = await prisma.outboundEmail.findUnique({ where: { id: outboundId } })
  if (!row || row.status === 'SENT' || row.status === 'SUPPRESSED') return
  const mailbox = row.mailboxId ? await prisma.mailbox.findUnique({ where: { id: row.mailboxId } }) : null
  if (!mailbox || !mailbox.active || mailbox.status === 'DISCONNECTED') {
    await prisma.outboundEmail.update({ where: { id: row.id }, data: { status: 'FAILED', lastError: 'Mailbox not connected' } })
    return
  }
  if (mailbox.shadowMode) {
    await prisma.outboundEmail.update({ where: { id: row.id }, data: { status: 'SUPPRESSED', lastError: 'Shadow mode is on: email not sent' } })
    return
  }

  const attachments: OutgoingAttachment[] = []
  if (row.attachmentIds.length) {
    const files = await prisma.attachment.findMany({ where: { id: { in: row.attachmentIds } } })
    for (const f of files) attachments.push({ fileName: f.fileName, mimeType: f.mimeType, content: await readStoredFile(f.storagePath) })
  }

  const isThread = THREAD_KINDS.has(row.kind) && row.ticketId
  const replyTo = isThread ? await replyContextFor(row.ticketId!, mailbox.id) : undefined

  try {
    const result = await adapterFor(mailbox).send({
      to: row.toEmails,
      cc: row.ccEmails,
      subject: row.subject,
      html: row.bodyHtml,
      attachments,
      replyTo,
    })
    await prisma.outboundEmail.update({
      where: { id: row.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastError: result.skippedAttachments.length ? `Not attached (too large for email): ${result.skippedAttachments.join(', ')}` : null,
        providerMessageId: result.providerMessageId,
        internetMessageId: result.internetMessageId,
      },
    })
    if (isThread && result.providerThreadId) {
      await prisma.emailThreadLink.upsert({
        where: { mailboxId_providerThreadId: { mailboxId: mailbox.id, providerThreadId: result.providerThreadId } },
        create: {
          mailboxId: mailbox.id,
          providerThreadId: result.providerThreadId,
          ticketId: row.ticketId!,
          lastProviderMessageId: result.providerMessageId,
        },
        update: {},
      })
    }
    if (row.messageId && result.internetMessageId) {
      await prisma.ticketMessage.update({
        where: { id: row.messageId },
        data: { internetMessageId: result.internetMessageId, providerMessageId: result.providerMessageId },
      }).catch(() => undefined)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.outboundEmail.update({
      where: { id: row.id },
      data: { status: 'FAILED', attempts: { increment: 1 }, lastError: message.slice(0, 1000) },
    })
    if (err instanceof ReconnectRequiredError) {
      await markReconnectRequired(mailbox.id, message)
      return // retrying will not help until the admin reconnects
    }
    await mailboxEvent(mailbox.id, 'warn', `Sending "${row.subject}" failed: ${message}`)
    throw err // let pg-boss retry with backoff
  }
}
