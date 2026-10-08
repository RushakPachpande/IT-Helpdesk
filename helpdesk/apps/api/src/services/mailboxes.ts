import { createAdapter, type MailAdapter, type OAuthClientConfig, type ProviderName } from '@helpdesk/mail'
import { prisma, type Mailbox } from '../db.js'
import { config } from '../config.js'
import { decrypt, encrypt } from '../crypto.js'
import { publish } from './events.js'

export function providerSlug(provider: ProviderName): string {
  return provider === 'MICROSOFT' ? 'microsoft' : 'google'
}

export function providerFromSlug(slug: string): ProviderName | null {
  if (slug === 'microsoft') return 'MICROSOFT'
  if (slug === 'google') return 'GOOGLE'
  return null
}

export function redirectUri(provider: ProviderName): string {
  return `${config.oauthRedirectBase}/api/mailbox/oauth/${providerSlug(provider)}/callback`
}

export function providerConfig(provider: ProviderName): OAuthClientConfig {
  if (provider === 'MICROSOFT') {
    return {
      clientId: config.microsoft.clientId,
      clientSecret: config.microsoft.clientSecret,
      tenantId: config.microsoft.tenantId,
      redirectUri: redirectUri(provider),
    }
  }
  return { clientId: config.google.clientId, clientSecret: config.google.clientSecret, redirectUri: redirectUri(provider) }
}

export function isProviderConfigured(provider: ProviderName): boolean {
  const c = providerConfig(provider)
  return Boolean(c.clientId && c.clientSecret)
}

/** Adapter for a stored mailbox; refreshed tokens are re-encrypted and saved automatically. */
export function adapterFor(mailbox: Mailbox): MailAdapter {
  if (mailbox.provider === 'IMAP') throw new Error('IMAP mailboxes are not supported yet')
  const provider = mailbox.provider as ProviderName
  return createAdapter(provider, providerConfig(provider), decrypt(mailbox.tokenData), async (tokenData) => {
    await prisma.mailbox.update({ where: { id: mailbox.id }, data: { tokenData: encrypt(tokenData) } })
  })
}

export async function mailboxEvent(mailboxId: string, level: 'info' | 'warn' | 'error', message: string) {
  await prisma.mailboxEvent.create({ data: { mailboxId, level, message: message.slice(0, 2000) } }).catch(() => undefined)
  if (level !== 'info') await publish({ type: 'mailbox.changed' })
}

export async function markReconnectRequired(mailboxId: string, reason: string) {
  await prisma.mailbox.update({ where: { id: mailboxId }, data: { status: 'RECONNECT_REQUIRED', lastError: reason } })
  await mailboxEvent(mailboxId, 'error', `Reconnect required: ${reason}`)
}
