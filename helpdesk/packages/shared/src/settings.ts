import { z } from 'zod'

export const aiProviderSchema = z.enum(['openrouter', 'groq'])

export const settingsSchema = z.object({
  ticketId: z.object({
    prefix: z.string().min(1).max(10).regex(/^[A-Za-z0-9]+$/, 'Letters and digits only'),
    format: z
      .string()
      .min(1)
      .max(60)
      .refine((f) => /\{SEQ(:\d)?\}/.test(f), 'Format must contain {SEQ} or {SEQ:n}'),
  }),
  attachments: z.object({
    maxFileMb: z.number().int().min(1).max(50),
    maxFilesPerMessage: z.number().int().min(1).max(20),
    allowedMimeTypes: z.array(z.string().min(1)).min(1),
    /** Inline email images smaller than this are treated as logos/signatures and skipped. */
    skipInlineImagesUnderKb: z.number().int().min(0).max(1024),
  }),
  email: z.object({
    pollIntervalMinutes: z.number().int().min(1).max(60),
    /** On first connect, only import mail received within this many minutes. */
    initialLookbackMinutes: z.number().int().min(0).max(60 * 24 * 7),
    sendAck: z.boolean(),
    notifyRequesterOnReply: z.boolean(),
    notifyRequesterOnStatus: z.boolean(),
    notifyAgentOnAssign: z.boolean(),
    notifyAgentOnRequesterReply: z.boolean(),
    reopenWindowDays: z.number().int().min(0).max(365),
    autoReplySubjectPrefixes: z.array(z.string()),
  }),
  templates: z.object({
    ackSubject: z.string(),
    ackBody: z.string(),
    webCreatedSubject: z.string(),
    webCreatedBody: z.string(),
    replyBody: z.string(),
    resolvedBody: z.string(),
    closedBody: z.string(),
    assignedBody: z.string(),
  }),
  ai: z.object({
    enabled: z.boolean(),
    provider: aiProviderSchema,
    model: z.string(),
    /** Write-only from the UI; returned masked. Stored encrypted. */
    apiKey: z.string().optional(),
    applySuggestedPriority: z.boolean(),
  }),
})

export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  ticketId: { prefix: 'NGI', format: '{PREFIX}-{YYYY}{MM}{DD}-{SEQ:4}' },
  attachments: {
    maxFileMb: 10,
    maxFilesPerMessage: 5,
    allowedMimeTypes: [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    skipInlineImagesUnderKb: 15,
  },
  email: {
    pollIntervalMinutes: 2,
    initialLookbackMinutes: 60,
    sendAck: true,
    notifyRequesterOnReply: true,
    notifyRequesterOnStatus: true,
    notifyAgentOnAssign: true,
    notifyAgentOnRequesterReply: true,
    reopenWindowDays: 7,
    autoReplySubjectPrefixes: [
      'automatic reply:',
      'auto:',
      'out of office',
      'undeliverable:',
      'read:',
      'delivery status notification',
      'mail delivery failed',
    ],
  },
  templates: {
    ackSubject: '[{ticketNumber}] {subject}',
    ackBody:
      'Hi {requesterName},\n\nThanks for contacting IT Support. Your request has been logged as ticket {ticketNumber}.\nPriority: {priority}\n\nYou can reply to this email to add information, or follow the ticket here: {ticketUrl}\n\nIT Support',
    webCreatedSubject: '[{ticketNumber}] {subject}',
    webCreatedBody:
      'Hi {requesterName},\n\nYour IT support request has been created as ticket {ticketNumber}.\nPriority: {priority}\n\nYou can reply to this email or use the helpdesk: {ticketUrl}\n\nIT Support',
    replyBody: '{message}\n\n--\n{agentName}, IT Support\nTicket {ticketNumber}: {ticketUrl}',
    resolvedBody:
      'Hi {requesterName},\n\nTicket {ticketNumber} has been marked as resolved.\n\nResolution: {resolutionNotes}\n\nIf the issue is not fixed, reply to this email within {reopenWindowDays} days to reopen it.\n\nIT Support',
    closedBody: 'Hi {requesterName},\n\nTicket {ticketNumber} is now closed.\n\nIT Support',
    assignedBody: 'Ticket {ticketNumber} "{subject}" has been assigned to you.\n\n{ticketUrl}',
  },
  ai: {
    enabled: false,
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    applySuggestedPriority: false,
  },
}

/** Deep-merge stored settings over defaults so new keys always have values. */
export function mergeSettings(stored: unknown): Settings {
  const s = (stored ?? {}) as Partial<Record<keyof Settings, Record<string, unknown>>>
  const merged = {} as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    merged[key] = { ...DEFAULT_SETTINGS[key], ...(s[key] ?? {}) }
  }
  return merged as Settings
}

/** Replace {placeholders} in a template. Unknown placeholders are left as-is. */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = vars[name]
    return v === undefined || v === null ? match : String(v)
  })
}
