import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { completeOAuth, startOAuth, SUPPORTED_PROVIDERS } from '@helpdesk/mail'
import { prisma } from '../db.js'
import { badRequest, notFound, parse } from '../http.js'
import { requireAdmin, requireAuth } from '../auth/session.js'
import { encrypt, randomToken } from '../crypto.js'
import { audit } from '../services/audit.js'
import { getSettings } from '../services/settings.js'
import { enqueue, QUEUES } from '../services/boss.js'
import { publish } from '../services/events.js'
import { isProviderConfigured, mailboxEvent, providerConfig, providerFromSlug, redirectUri } from '../services/mailboxes.js'

interface PendingOAuth {
  provider: 'MICROSOFT' | 'GOOGLE'
  userId: string
  codeVerifier?: string
  expiresAt: number
}

const pending = new Map<string, PendingOAuth>()
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function isLocalRequest(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname.replace(/:\d+$/, '').toLowerCase())
}

const mailboxSelect = {
  id: true,
  provider: true,
  address: true,
  displayName: true,
  status: true,
  active: true,
  shadowMode: true,
  lastSyncAt: true,
  lastError: true,
  syncStartAt: true,
  createdAt: true,
} as const

export async function mailboxRoutes(app: FastifyInstance) {
  app.get('/api/admin/mailbox', { preHandler: requireAdmin }, async (req) => {
    const mailbox = await prisma.mailbox.findFirst({ where: { active: true }, select: mailboxSelect, orderBy: { updatedAt: 'desc' } })
    const [events, outbound] = mailbox
      ? await Promise.all([
          prisma.mailboxEvent.findMany({ where: { mailboxId: mailbox.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
          prisma.outboundEmail.findMany({
            orderBy: { createdAt: 'desc' },
            take: 30,
            select: { id: true, kind: true, status: true, toEmails: true, subject: true, lastError: true, attempts: true, sentAt: true, createdAt: true, ticketId: true },
          }),
        ])
      : [[], []]
    return {
      mailbox,
      events,
      outbound,
      isLocal: isLocalRequest(req.hostname),
      providers: SUPPORTED_PROVIDERS.map((p) => ({ provider: p, configured: isProviderConfigured(p), redirectUri: redirectUri(p) })),
    }
  })

  /** Full-page navigation from the admin UI; only works from the host machine (OAuth redirect rules). */
  app.get('/api/admin/mailbox/connect/:provider', { preHandler: requireAdmin }, async (req, reply) => {
    const user = requireAuth(req)
    const provider = providerFromSlug((req.params as { provider: string }).provider)
    if (!provider) throw badRequest('Unknown provider')
    if (!isLocalRequest(req.hostname)) {
      return reply.redirect(`/admin/mailbox?error=${encodeURIComponent('Open the app at http://localhost on the host machine to connect the mailbox.')}`)
    }
    if (!isProviderConfigured(provider)) {
      return reply.redirect(`/admin/mailbox?error=${encodeURIComponent(`${provider} OAuth client ID/secret are not configured in .env`)}`)
    }
    for (const [k, v] of pending) if (v.expiresAt < Date.now()) pending.delete(k)
    const state = randomToken(24)
    const start = await startOAuth(provider, providerConfig(provider), state)
    pending.set(state, { provider, userId: user.id, codeVerifier: start.codeVerifier, expiresAt: Date.now() + 10 * 60_000 })
    return reply.redirect(start.url)
  })

  app.get('/api/mailbox/oauth/:slug/callback', async (req, reply) => {
    const fail = (msg: string) => reply.redirect(`/admin/mailbox?error=${encodeURIComponent(msg)}`)
    const q = z
      .object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional(), error_description: z.string().optional() })
      .parse(req.query)
    if (q.error) return fail(q.error_description ?? q.error)
    const entry = q.state ? pending.get(q.state) : undefined
    if (q.state) pending.delete(q.state)
    if (!entry || entry.expiresAt < Date.now()) return fail('Sign-in session expired. Please try connecting again.')
    if (!req.user || req.user.id !== entry.userId || req.user.role !== 'ADMIN') return fail('Sign in as the admin who started the connection.')
    if (!q.code) return fail('No authorization code returned')
    try {
      const account = await completeOAuth(entry.provider, providerConfig(entry.provider), q.code, entry.codeVerifier)
      const settings = await getSettings()
      const syncStartAt = new Date(Date.now() - settings.email.initialLookbackMinutes * 60_000)
      const mailbox = await prisma.$transaction(async (tx) => {
        await tx.mailbox.updateMany({ where: { active: true }, data: { active: false } })
        return tx.mailbox.upsert({
          where: { provider_address: { provider: entry.provider, address: account.address } },
          create: {
            provider: entry.provider,
            address: account.address,
            displayName: account.displayName,
            tokenData: encrypt(account.tokenData),
            status: 'CONNECTED',
            active: true,
            syncStartAt,
            connectedById: entry.userId,
          },
          update: {
            displayName: account.displayName,
            tokenData: encrypt(account.tokenData),
            status: 'CONNECTED',
            active: true,
            lastError: null,
            connectedById: entry.userId,
            // Keep the cursor on reconnect so no mail is skipped or duplicated.
          },
        })
      })
      await mailboxEvent(mailbox.id, 'info', `Connected ${account.address} (${entry.provider})`)
      await audit(entry.userId, 'mailbox.connected', 'mailbox', mailbox.id, { provider: entry.provider, address: account.address })
      await enqueue(QUEUES.mailSync, { force: true }, { retryLimit: 0 })
      await publish({ type: 'mailbox.changed' })
      return reply.redirect('/admin/mailbox?connected=1')
    } catch (err) {
      req.log.error(err)
      return fail(err instanceof Error ? err.message : 'Could not connect the mailbox')
    }
  })

  app.post('/api/admin/mailbox/sync', { preHandler: requireAdmin }, async () => {
    const mailbox = await prisma.mailbox.findFirst({ where: { active: true } })
    if (!mailbox) throw badRequest('No mailbox connected')
    await enqueue(QUEUES.mailSync, { force: true }, { retryLimit: 0 })
    return { ok: true }
  })

  app.patch('/api/admin/mailbox', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const body = parse(z.object({ shadowMode: z.boolean() }), req.body)
    const mailbox = await prisma.mailbox.findFirst({ where: { active: true } })
    if (!mailbox) throw notFound('No mailbox connected')
    await prisma.mailbox.update({ where: { id: mailbox.id }, data: body })
    await mailboxEvent(mailbox.id, 'info', `Shadow mode ${body.shadowMode ? 'enabled' : 'disabled'}`)
    await audit(admin.id, 'mailbox.updated', 'mailbox', mailbox.id, body)
    return { ok: true }
  })

  app.post('/api/admin/mailbox/disconnect', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const mailbox = await prisma.mailbox.findFirst({ where: { active: true } })
    if (!mailbox) throw notFound('No mailbox connected')
    // Keep the row (thread links and history) but drop the tokens.
    await prisma.mailbox.update({
      where: { id: mailbox.id },
      data: { active: false, status: 'DISCONNECTED', tokenData: encrypt('{}'), syncCursor: null },
    })
    await mailboxEvent(mailbox.id, 'info', 'Disconnected by admin')
    await audit(admin.id, 'mailbox.disconnected', 'mailbox', mailbox.id)
    await publish({ type: 'mailbox.changed' })
    return { ok: true }
  })

  app.post('/api/admin/outbound/:id/retry', { preHandler: requireAdmin }, async (req) => {
    const { id } = req.params as { id: string }
    const row = await prisma.outboundEmail.findUnique({ where: { id } })
    if (!row) throw notFound()
    if (row.status === 'SENT') throw badRequest('Already sent')
    const mailbox = await prisma.mailbox.findFirst({ where: { active: true } })
    if (!mailbox || mailbox.status !== 'CONNECTED') throw badRequest('Connect the mailbox first')
    await prisma.outboundEmail.update({ where: { id }, data: { status: 'QUEUED', lastError: null, mailboxId: mailbox.id } })
    await enqueue(QUEUES.mailSend, { outboundId: id })
    return { ok: true }
  })
}
