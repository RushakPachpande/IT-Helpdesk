export type ProviderName = 'MICROSOFT' | 'GOOGLE'

export interface NormalizedMessage {
  providerMessageId: string
  providerThreadId: string | null
  internetMessageId: string | null
  subject: string
  fromEmail: string
  fromName: string
  to: string[]
  cc: string[]
  receivedAt: Date
  html: string | null
  text: string | null
  /** Lower-cased header names. */
  headers: Record<string, string>
  inReplyTo: string[]
  references: string[]
  hasAttachments: boolean
  /** Provider says this message was sent by the mailbox itself (e.g. Gmail SENT label). */
  sentByMailbox: boolean
}

export interface InboundAttachment {
  fileName: string
  mimeType: string
  sizeBytes: number
  inline: boolean
  contentId: string | null
  content: Buffer
}

export interface OutgoingAttachment {
  fileName: string
  mimeType: string
  content: Buffer
}

export interface ReplyContext {
  /** Provider message to reply to (Graph createReply). */
  providerMessageId?: string | null
  /** Gmail thread to send into. */
  providerThreadId?: string | null
  /** RFC 5322 Message-ID of the message being answered. */
  internetMessageId?: string | null
  references?: string[]
}

export interface OutgoingMail {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  attachments?: OutgoingAttachment[]
  replyTo?: ReplyContext
}

export interface SentResult {
  providerMessageId: string | null
  providerThreadId: string | null
  internetMessageId: string | null
  /** Attachments that could not be sent (e.g. over the provider's inline size limit). */
  skippedAttachments: string[]
}

export interface ChangeBatch {
  messageIds: string[]
  cursor: string
}

export interface MailAdapter {
  readonly provider: ProviderName
  /**
   * Return ids of messages added to the inbox since `cursor`.
   * With a null cursor, starts tracking and returns messages received after `since`.
   */
  listChanges(cursor: string | null, since: Date): Promise<ChangeBatch>
  getMessage(providerMessageId: string): Promise<NormalizedMessage>
  getAttachments(providerMessageId: string): Promise<InboundAttachment[]>
  send(mail: OutgoingMail): Promise<SentResult>
}

export interface OAuthClientConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Microsoft only. */
  tenantId?: string
}

export interface OAuthStart {
  url: string
  /** Secret that must be kept server-side until the callback (PKCE verifier). */
  codeVerifier?: string
}

export interface ConnectedAccount {
  address: string
  displayName: string | null
  /** Opaque JSON to be encrypted and stored. */
  tokenData: string
}

/** Called when an adapter refreshes tokens so the caller can persist them. */
export type TokenDataListener = (tokenData: string) => Promise<void> | void

/** The stored sync cursor is no longer valid; caller should reset it and resync recent mail. */
export class CursorExpiredError extends Error {
  constructor(message = 'Sync cursor expired') {
    super(message)
    this.name = 'CursorExpiredError'
  }
}

/** Tokens were revoked or expired; the admin must reconnect the mailbox. */
export class ReconnectRequiredError extends Error {
  constructor(message = 'Mailbox must be reconnected') {
    super(message)
    this.name = 'ReconnectRequiredError'
  }
}
