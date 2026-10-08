import { gmail, type gmail_v1 } from '@googleapis/gmail'
import { OAuth2Client, type Credentials } from 'google-auth-library'
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
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

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

function oauthClient(cfg: OAuthClientConfig): OAuth2Client {
  return new OAuth2Client({ clientId: cfg.clientId, clientSecret: cfg.clientSecret, redirectUri: cfg.redirectUri })
}

export async function googleAuthStart(cfg: OAuthClientConfig, state: string): Promise<OAuthStart> {
  const url = oauthClient(cfg).generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state,
  })
  return { url }
}

export async function googleAuthComplete(cfg: OAuthClientConfig, code: string): Promise<ConnectedAccount> {
  const client = oauthClient(cfg)
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove the app from the Google account permissions and connect again.')
  }
  client.setCredentials(tokens)
  const profile = await gmail({ version: 'v1', auth: client }).users.getProfile({ userId: 'me' })
  return {
    address: String(profile.data.emailAddress ?? '').toLowerCase(),
    displayName: null,
    tokenData: JSON.stringify(tokens),
  }
}

function decodeB64Url(data: string | null | undefined): Buffer {
  if (!data) return Buffer.alloc(0)
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function splitAddress(value: string): { email: string; name: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value)
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() }
  return { name: '', email: value.trim().toLowerCase() }
}

function addressList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((v) => splitAddress(v).email)
    .filter((e) => e.includes('@'))
}

interface PartInfo {
  html: string | null
  text: string | null
  attachments: { part: gmail_v1.Schema$MessagePart; inline: boolean; contentId: string | null }[]
}

function walkParts(part: gmail_v1.Schema$MessagePart | undefined, info: PartInfo): PartInfo {
  if (!part) return info
  const mime = (part.mimeType ?? '').toLowerCase()
  const partHeaders: Record<string, string> = {}
  for (const h of part.headers ?? []) if (h.name) partHeaders[h.name.toLowerCase()] = h.value ?? ''
  const disposition = (partHeaders['content-disposition'] ?? '').toLowerCase()
  const isAttachment = Boolean(part.filename) && (Boolean(part.body?.attachmentId) || Boolean(part.body?.data))
  if (isAttachment) {
    const contentId = partHeaders['content-id']?.replace(/[<>]/g, '') ?? null
    info.attachments.push({ part, inline: disposition.startsWith('inline') || Boolean(contentId), contentId })
  } else if (mime === 'text/html' && info.html === null) {
    info.html = decodeB64Url(part.body?.data).toString('utf8')
  } else if (mime === 'text/plain' && info.text === null) {
    info.text = decodeB64Url(part.body?.data).toString('utf8')
  }
  for (const child of part.parts ?? []) walkParts(child, info)
  return info
}

/** Pure mapping from a Gmail `format=full` message to the normalized shape. */
export function parseGmailMessage(m: gmail_v1.Schema$Message): NormalizedMessage {
  const headers: Record<string, string> = {}
  for (const h of m.payload?.headers ?? []) if (h.name) headers[h.name.toLowerCase()] = h.value ?? ''
  const info = walkParts(m.payload, { html: null, text: null, attachments: [] })
  const from = splitAddress(headers['from'] ?? '')
  return {
    providerMessageId: m.id ?? '',
    providerThreadId: m.threadId ?? null,
    internetMessageId: headers['message-id'] ?? null,
    subject: headers['subject'] ?? '',
    fromEmail: from.email,
    fromName: from.name,
    to: addressList(headers['to']),
    cc: addressList(headers['cc']),
    receivedAt: new Date(Number(m.internalDate ?? Date.now())),
    html: info.html,
    text: info.text ?? m.snippet ?? null,
    headers,
    inReplyTo: parseMessageIds(headers['in-reply-to']),
    references: parseMessageIds(headers['references']),
    hasAttachments: info.attachments.length > 0,
    sentByMailbox: (m.labelIds ?? []).includes('SENT'),
  }
}

function isNotFound(err: any): boolean {
  return err?.code === 404 || err?.status === 404 || err?.response?.status === 404
}

function isAuthError(err: any): boolean {
  const msg = String(err?.response?.data?.error ?? err?.message ?? '')
  return err?.code === 401 || /invalid_grant|unauthorized_client|Token has been expired or revoked/i.test(msg)
}

export class GoogleAdapter implements MailAdapter {
  readonly provider = 'GOOGLE' as const
  private client: OAuth2Client
  private api: gmail_v1.Gmail
  private tokens: Credentials

  constructor(cfg: OAuthClientConfig, tokenData: string, onTokenData?: TokenDataListener) {
    this.tokens = JSON.parse(tokenData)
    this.client = oauthClient(cfg)
    this.client.setCredentials(this.tokens)
    this.client.on('tokens', (t) => {
      this.tokens = { ...this.tokens, ...t, refresh_token: t.refresh_token ?? this.tokens.refresh_token }
      void onTokenData?.(JSON.stringify(this.tokens))
    })
    this.api = gmail({ version: 'v1', auth: this.client })
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err: any) {
      if (isAuthError(err)) throw new ReconnectRequiredError(`Gmail authorization failed: ${err?.message}`)
      throw err
    }
  }

  async listChanges(cursor: string | null, since: Date): Promise<ChangeBatch> {
    if (!cursor) {
      const profile = await this.call(() => this.api.users.getProfile({ userId: 'me' }))
      const ids: string[] = []
      let pageToken: string | undefined
      const after = Math.floor(since.getTime() / 1000)
      do {
        const res = await this.call(() =>
          this.api.users.messages.list({ userId: 'me', q: `in:inbox after:${after}`, maxResults: 100, pageToken }),
        )
        for (const m of res.data.messages ?? []) if (m.id) ids.push(m.id)
        pageToken = res.data.nextPageToken ?? undefined
      } while (pageToken)
      return { messageIds: ids, cursor: String(profile.data.historyId) }
    }

    const ids = new Set<string>()
    let pageToken: string | undefined
    let latest = cursor
    try {
      do {
        const res = await this.call(() =>
          this.api.users.history.list({
            userId: 'me',
            startHistoryId: cursor,
            historyTypes: ['messageAdded'],
            labelId: 'INBOX',
            pageToken,
          }),
        )
        for (const h of res.data.history ?? []) {
          for (const added of h.messagesAdded ?? []) {
            const id = added.message?.id
            if (id && (added.message?.labelIds ?? []).includes('INBOX')) ids.add(id)
          }
        }
        if (res.data.historyId) latest = String(res.data.historyId)
        pageToken = res.data.nextPageToken ?? undefined
      } while (pageToken)
    } catch (err) {
      if (isNotFound(err)) throw new CursorExpiredError('Gmail historyId is too old')
      throw err
    }
    return { messageIds: [...ids], cursor: latest }
  }

  async getMessage(id: string): Promise<NormalizedMessage> {
    const res = await this.call(() => this.api.users.messages.get({ userId: 'me', id, format: 'full' }))
    return parseGmailMessage(res.data)
  }

  async getAttachments(id: string): Promise<InboundAttachment[]> {
    const res = await this.call(() => this.api.users.messages.get({ userId: 'me', id, format: 'full' }))
    const info = walkParts(res.data.payload, { html: null, text: null, attachments: [] })
    const out: InboundAttachment[] = []
    for (const { part, inline, contentId } of info.attachments) {
      let content: Buffer
      if (part.body?.attachmentId) {
        const att = await this.call(() =>
          this.api.users.messages.attachments.get({ userId: 'me', messageId: id, id: part.body!.attachmentId! }),
        )
        content = decodeB64Url(att.data.data)
      } else {
        content = decodeB64Url(part.body?.data)
      }
      out.push({
        fileName: part.filename || 'attachment',
        mimeType: part.mimeType || 'application/octet-stream',
        sizeBytes: content.length,
        inline,
        contentId,
        content,
      })
    }
    return out
  }

  async send(mail: OutgoingMail): Promise<SentResult> {
    const headers: Record<string, string> = {}
    if (mail.replyTo?.internetMessageId) {
      headers['In-Reply-To'] = mail.replyTo.internetMessageId
      const refs = [...(mail.replyTo.references ?? [])]
      if (!refs.includes(mail.replyTo.internetMessageId)) refs.push(mail.replyTo.internetMessageId)
      headers['References'] = refs.join(' ')
    }
    const composer = new MailComposer({
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject,
      html: mail.html,
      headers,
      attachments: (mail.attachments ?? []).map((a) => ({ filename: a.fileName, contentType: a.mimeType, content: a.content })),
    })
    const raw: Buffer = await new Promise((resolve, reject) =>
      composer.compile().build((err, msg) => (err ? reject(err) : resolve(msg))),
    )
    const res = await this.call(() =>
      this.api.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: raw.toString('base64url'),
          threadId: mail.replyTo?.providerThreadId ?? undefined,
        },
      }),
    )
    const sentId = res.data.id ?? null
    let internetMessageId: string | null = null
    if (sentId) {
      const meta = await this.call(() =>
        this.api.users.messages.get({ userId: 'me', id: sentId, format: 'metadata', metadataHeaders: ['Message-ID'] }),
      )
      internetMessageId = meta.data.payload?.headers?.find((h) => h.name?.toLowerCase() === 'message-id')?.value ?? null
    }
    return {
      providerMessageId: sentId,
      providerThreadId: res.data.threadId ?? null,
      internetMessageId,
      skippedAttachments: [],
    }
  }
}
