import { ConfidentialClientApplication, CryptoProvider, type AccountInfo } from '@azure/msal-node'
import { parseMessageIds } from './threading.js'
import {
  CursorExpiredError,
  ReconnectRequiredError,
  type ChangeBatch,
  type ConnectedAccount,
  type InboundAttachment,
  type MailAdapter,
  type NormalizedMessage,
  type OAuthClientConfig,
  type OAuthStart,
  type OutgoingMail,
  type SentResult,
  type TokenDataListener,
} from './types.js'

const GRAPH = 'https://graph.microsoft.com/v1.0'
export const MICROSOFT_SCOPES = ['offline_access', 'User.Read', 'Mail.ReadWrite', 'Mail.Send']
/** Graph's limit for attachments added in a single POST; larger files need an upload session. */
const MAX_SIMPLE_ATTACHMENT_BYTES = 3 * 1024 * 1024

interface MsTokenData {
  cache: string
  homeAccountId: string
}

function msalApp(cfg: OAuthClientConfig): ConfidentialClientApplication {
  return new ConfidentialClientApplication({
    auth: {
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      authority: `https://login.microsoftonline.com/${cfg.tenantId || 'organizations'}`,
    },
  })
}

export async function microsoftAuthStart(cfg: OAuthClientConfig, state: string): Promise<OAuthStart> {
  const pkce = await new CryptoProvider().generatePkceCodes()
  const url = await msalApp(cfg).getAuthCodeUrl({
    scopes: MICROSOFT_SCOPES,
    redirectUri: cfg.redirectUri,
    state,
    codeChallenge: pkce.challenge,
    codeChallengeMethod: 'S256',
    prompt: 'select_account',
  })
  return { url, codeVerifier: pkce.verifier }
}

export async function microsoftAuthComplete(
  cfg: OAuthClientConfig,
  code: string,
  codeVerifier: string,
): Promise<ConnectedAccount> {
  const app = msalApp(cfg)
  const result = await app.acquireTokenByCode({
    code,
    scopes: MICROSOFT_SCOPES,
    redirectUri: cfg.redirectUri,
    codeVerifier,
  })
  if (!result.account) throw new Error('Microsoft sign-in returned no account')
  const me = await graphFetch(result.accessToken, `${GRAPH}/me?$select=mail,userPrincipalName,displayName`)
  const tokenData: MsTokenData = {
    cache: app.getTokenCache().serialize(),
    homeAccountId: result.account.homeAccountId,
  }
  return {
    address: String(me.mail || me.userPrincipalName || result.account.username).toLowerCase(),
    displayName: me.displayName ?? null,
    tokenData: JSON.stringify(tokenData),
  }
}

async function graphFetch(token: string, url: string, init: RequestInit = {}, attempt = 0): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'IdType="ImmutableId", odata.maxpagesize=50',
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 429 || res.status === 503 || res.status === 504) {
    if (attempt < 4) {
      const retryAfter = Number(res.headers.get('retry-after')) || 2 ** attempt
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 30) * 1000))
      return graphFetch(token, url, init, attempt + 1)
    }
  }
  if (res.status === 410) throw new CursorExpiredError('Graph delta token expired (410 Gone)')
  if (res.status === 401) throw new ReconnectRequiredError('Microsoft Graph rejected the access token')
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Graph ${init.method ?? 'GET'} ${url.split('?')[0]} failed: ${res.status} ${body.slice(0, 500)}`)
  }
  if (res.status === 202 || res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

function addr(r: any): { email: string; name: string } {
  const e = r?.emailAddress ?? {}
  return { email: String(e.address ?? '').toLowerCase(), name: String(e.name ?? '') }
}

/** Pure mapping from a Graph message resource to the normalized shape. */
export function parseGraphMessage(m: any): NormalizedMessage {
  const headers: Record<string, string> = {}
  for (const h of m.internetMessageHeaders ?? []) {
    if (h?.name) headers[String(h.name).toLowerCase()] = String(h.value ?? '')
  }
  const from = addr(m.from ?? m.sender)
  const isHtml = String(m.body?.contentType ?? '').toLowerCase() === 'html'
  return {
    providerMessageId: m.id,
    providerThreadId: m.conversationId ?? null,
    internetMessageId: m.internetMessageId ?? null,
    subject: m.subject ?? '',
    fromEmail: from.email,
    fromName: from.name,
    to: (m.toRecipients ?? []).map((r: any) => addr(r).email).filter(Boolean),
    cc: (m.ccRecipients ?? []).map((r: any) => addr(r).email).filter(Boolean),
    receivedAt: new Date(m.receivedDateTime ?? m.createdDateTime ?? Date.now()),
    html: isHtml ? (m.body?.content ?? null) : null,
    text: isHtml ? (m.bodyPreview ?? null) : (m.body?.content ?? m.bodyPreview ?? null),
    headers,
    inReplyTo: parseMessageIds(headers['in-reply-to']),
    references: parseMessageIds(headers['references']),
    hasAttachments: Boolean(m.hasAttachments),
    sentByMailbox: false,
  }
}

export class MicrosoftAdapter implements MailAdapter {
  readonly provider = 'MICROSOFT' as const
  private data: MsTokenData

  constructor(
    private cfg: OAuthClientConfig,
    tokenData: string,
    private onTokenData?: TokenDataListener,
  ) {
    this.data = JSON.parse(tokenData)
  }

  private async token(): Promise<string> {
    const app = msalApp(this.cfg)
    const cache = app.getTokenCache()
    cache.deserialize(this.data.cache)
    const accounts: AccountInfo[] = await cache.getAllAccounts()
    const account = accounts.find((a) => a.homeAccountId === this.data.homeAccountId) ?? accounts[0]
    if (!account) throw new ReconnectRequiredError('No Microsoft account in token cache')
    try {
      const result = await app.acquireTokenSilent({ account, scopes: MICROSOFT_SCOPES })
      const serialized = cache.serialize()
      if (serialized !== this.data.cache) {
        this.data = { ...this.data, cache: serialized }
        await this.onTokenData?.(JSON.stringify(this.data))
      }
      return result.accessToken
    } catch (err: any) {
      if (err?.name === 'InteractionRequiredAuthError' || /invalid_grant|interaction_required/i.test(String(err?.errorCode ?? err?.message))) {
        throw new ReconnectRequiredError(`Microsoft token refresh failed: ${err?.errorCode ?? err?.message}`)
      }
      throw err
    }
  }

  async listChanges(cursor: string | null, since: Date): Promise<ChangeBatch> {
    const token = await this.token()
    // receivedDateTime ge is the only $filter delta supports; it keeps the first round from walking the whole inbox.
    const sinceIso = since.toISOString().replace(/\.\d{3}Z$/, 'Z')
    let url =
      cursor ??
      `${GRAPH}/me/mailFolders/inbox/messages/delta?changeType=created&$select=id,receivedDateTime&$filter=${encodeURIComponent(`receivedDateTime ge ${sinceIso}`)}`
    const ids: string[] = []
    for (;;) {
      const page = await graphFetch(token, url)
      for (const m of page?.value ?? []) {
        if (m['@removed']) continue
        if (!cursor && m.receivedDateTime && new Date(m.receivedDateTime) < since) continue
        ids.push(m.id)
      }
      if (page?.['@odata.nextLink']) {
        url = page['@odata.nextLink']
        continue
      }
      const deltaLink = page?.['@odata.deltaLink']
      if (!deltaLink) throw new Error('Graph delta response had neither nextLink nor deltaLink')
      return { messageIds: ids, cursor: deltaLink }
    }
  }

  async getMessage(id: string): Promise<NormalizedMessage> {
    const token = await this.token()
    const select = [
      'id', 'subject', 'from', 'sender', 'toRecipients', 'ccRecipients', 'receivedDateTime',
      'conversationId', 'internetMessageId', 'internetMessageHeaders', 'body', 'bodyPreview', 'hasAttachments',
    ].join(',')
    const m = await graphFetch(token, `${GRAPH}/me/messages/${encodeURIComponent(id)}?$select=${select}`)
    return parseGraphMessage(m)
  }

  async getAttachments(id: string): Promise<InboundAttachment[]> {
    const token = await this.token()
    const res = await graphFetch(token, `${GRAPH}/me/messages/${encodeURIComponent(id)}/attachments`)
    const out: InboundAttachment[] = []
    for (const a of res?.value ?? []) {
      if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || !a.contentBytes) continue
      const content = Buffer.from(a.contentBytes, 'base64')
      out.push({
        fileName: a.name || 'attachment',
        mimeType: a.contentType || 'application/octet-stream',
        sizeBytes: content.length,
        inline: Boolean(a.isInline),
        contentId: a.contentId ?? null,
        content,
      })
    }
    return out
  }

  async send(mail: OutgoingMail): Promise<SentResult> {
    const token = await this.token()
    const recipients = (list: string[] | undefined) => (list ?? []).map((address) => ({ emailAddress: { address } }))

    let draft: any
    if (mail.replyTo?.providerMessageId) {
      try {
        draft = await graphFetch(token, `${GRAPH}/me/messages/${encodeURIComponent(mail.replyTo.providerMessageId)}/createReply`, {
          method: 'POST',
          body: '{}',
        })
      } catch {
        draft = null // original message deleted or moved out of reach: fall back to a new message
      }
    }
    const fields = {
      subject: mail.subject,
      body: { contentType: 'HTML', content: mail.html },
      toRecipients: recipients(mail.to),
      ccRecipients: recipients(mail.cc),
    }
    if (draft) {
      await graphFetch(token, `${GRAPH}/me/messages/${encodeURIComponent(draft.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      })
    } else {
      draft = await graphFetch(token, `${GRAPH}/me/messages`, { method: 'POST', body: JSON.stringify(fields) })
    }

    const skipped: string[] = []
    for (const att of mail.attachments ?? []) {
      if (att.content.length > MAX_SIMPLE_ATTACHMENT_BYTES) {
        skipped.push(att.fileName)
        continue
      }
      await graphFetch(token, `${GRAPH}/me/messages/${encodeURIComponent(draft.id)}/attachments`, {
        method: 'POST',
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: att.fileName,
          contentType: att.mimeType,
          contentBytes: att.content.toString('base64'),
        }),
      })
    }

    const meta = await graphFetch(
      token,
      `${GRAPH}/me/messages/${encodeURIComponent(draft.id)}?$select=id,conversationId,internetMessageId`,
    )
    await graphFetch(token, `${GRAPH}/me/messages/${encodeURIComponent(draft.id)}/send`, { method: 'POST' })
    return {
      providerMessageId: meta?.id ?? draft.id,
      providerThreadId: meta?.conversationId ?? null,
      internetMessageId: meta?.internetMessageId ?? null,
      skippedAttachments: skipped,
    }
  }
}
