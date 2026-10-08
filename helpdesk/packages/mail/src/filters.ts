const HIGH_PRIORITY_KEYWORDS = [
  'urgent', 'asap', 'critical', 'down', 'outage', 'emergency',
  'not working', 'cannot work', "can't work", 'blocked',
  'security breach', 'breach', 'data loss', 'production down',
  'server down', 'all hands', 'cannot access', "can't access",
]

const LOW_PRIORITY_KEYWORDS = [
  'whenever', 'no rush', 'minor', 'question', 'inquiry',
  'when you get a chance', 'low priority', 'just curious', 'fyi',
]

function containsKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z])${escaped}($|[^a-z])`, 'i').test(text)
}

export type DetectedPriority = 'High' | 'Medium' | 'Low'

export function detectPriority(subject: string, body: string): DetectedPriority {
  const text = `${subject} ${body}`.toLowerCase()
  if (HIGH_PRIORITY_KEYWORDS.some((k) => containsKeyword(text, k))) return 'High'
  if (LOW_PRIORITY_KEYWORDS.some((k) => containsKeyword(text, k))) return 'Low'
  return 'Medium'
}

export function isSelfSent(fromEmail: string, mailboxAddress: string): boolean {
  return fromEmail.trim().toLowerCase() === mailboxAddress.trim().toLowerCase()
}

export function isAutoReply(subject: string, headers: Record<string, string>, subjectPrefixes: string[]): boolean {
  const s = (subject || '').trim().toLowerCase()
  if (subjectPrefixes.some((p) => p && s.startsWith(p.toLowerCase()))) return true
  const autoSubmitted = headers['auto-submitted']?.toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return true
  const precedence = headers['precedence']?.toLowerCase()
  if (precedence && ['bulk', 'junk', 'auto_reply'].includes(precedence)) return true
  if (headers['x-autoreply'] || headers['x-autorespond'] || headers['x-failed-recipients']) return true
  if (headers['content-type']?.toLowerCase().includes('multipart/report')) return true
  return false
}

export function senderDisplayName(name: string | null | undefined, email: string): string {
  const n = (name ?? '').trim()
  if (n && n.toLowerCase() !== email.toLowerCase()) return n
  if (email.includes('@')) {
    return email
      .split('@')[0]
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim()
  }
  return 'Unknown sender'
}
