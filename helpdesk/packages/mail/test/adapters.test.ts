import { describe, expect, it } from 'vitest'
import { parseGraphMessage } from '../src/microsoft'
import { parseGmailMessage } from '../src/google'

const b64url = (s: string) => Buffer.from(s).toString('base64url')

describe('parseGraphMessage', () => {
  // Shape from GET /me/messages/{id} with $select incl. internetMessageHeaders.
  const graph = {
    id: 'AAMkAD-immutable',
    conversationId: 'AAQkAD-conv',
    internetMessageId: '<abc@mail.example.com>',
    subject: 'RE: [NGI-20261008-0001] Laptop',
    from: { emailAddress: { name: 'Jane Doe', address: 'Jane@Example.com' } },
    toRecipients: [{ emailAddress: { name: 'IT', address: 'it@example.com' } }],
    ccRecipients: [{ emailAddress: { name: 'Boss', address: 'boss@example.com' } }],
    receivedDateTime: '2026-10-08T10:00:00Z',
    body: { contentType: 'html', content: '<p>Hello</p>' },
    bodyPreview: 'Hello',
    hasAttachments: true,
    internetMessageHeaders: [
      { name: 'In-Reply-To', value: '<prev@mail.example.com>' },
      { name: 'References', value: '<root@x> <prev@mail.example.com>' },
      { name: 'Auto-Submitted', value: 'no' },
    ],
  }

  it('normalizes addresses, threading and headers', () => {
    const m = parseGraphMessage(graph)
    expect(m).toMatchObject({
      providerMessageId: 'AAMkAD-immutable',
      providerThreadId: 'AAQkAD-conv',
      internetMessageId: '<abc@mail.example.com>',
      fromEmail: 'jane@example.com',
      fromName: 'Jane Doe',
      to: ['it@example.com'],
      cc: ['boss@example.com'],
      html: '<p>Hello</p>',
      text: 'Hello',
      inReplyTo: ['<prev@mail.example.com>'],
      references: ['<root@x>', '<prev@mail.example.com>'],
      hasAttachments: true,
      sentByMailbox: false,
    })
    expect(m.headers['auto-submitted']).toBe('no')
    expect(m.receivedAt.toISOString()).toBe('2026-10-08T10:00:00.000Z')
  })

  it('uses the text body for plain-text messages', () => {
    const m = parseGraphMessage({ ...graph, body: { contentType: 'text', content: 'plain body' } })
    expect(m.html).toBeNull()
    expect(m.text).toBe('plain body')
  })
})

describe('parseGmailMessage', () => {
  // Shape from users.messages.get format=full.
  const gmail = {
    id: '18c0ffee',
    threadId: '18c0ffee',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'Hi IT',
    internalDate: '1791453600000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: '"Doe, Jane" <Jane@Example.com>' },
        { name: 'To', value: 'IT Support <it@example.com>' },
        { name: 'Cc', value: '"Smith, Bob" <bob@example.com>, carol@example.com' },
        { name: 'Subject', value: 'Printer jam' },
        { name: 'Message-ID', value: '<CAF123@mail.gmail.com>' },
        { name: 'References', value: '<root@x>' },
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: b64url('Hi IT\nPrinter jams') } },
            { mimeType: 'text/html', body: { data: b64url('<div>Hi IT<br>Printer jams</div>') } },
          ],
        },
        {
          mimeType: 'image/png',
          filename: 'jam.png',
          headers: [{ name: 'Content-Disposition', value: 'attachment; filename="jam.png"' }],
          body: { attachmentId: 'ANGjdJ', size: 2048 },
        },
      ],
    },
  }

  it('normalizes headers, bodies and attachments', () => {
    const m = parseGmailMessage(gmail)
    expect(m).toMatchObject({
      providerMessageId: '18c0ffee',
      providerThreadId: '18c0ffee',
      internetMessageId: '<CAF123@mail.gmail.com>',
      subject: 'Printer jam',
      fromEmail: 'jane@example.com',
      fromName: 'Doe, Jane',
      to: ['it@example.com'],
      cc: ['bob@example.com', 'carol@example.com'],
      html: '<div>Hi IT<br>Printer jams</div>',
      text: 'Hi IT\nPrinter jams',
      references: ['<root@x>'],
      hasAttachments: true,
      sentByMailbox: false,
    })
    expect(m.receivedAt.getTime()).toBe(1791453600000)
  })

  it('marks messages with the SENT label as sent by the mailbox', () => {
    expect(parseGmailMessage({ ...gmail, labelIds: ['SENT'] }).sentByMailbox).toBe(true)
  })
})
