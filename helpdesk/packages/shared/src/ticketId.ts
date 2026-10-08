export interface DateParts {
  YYYY: string
  YY: string
  MM: string
  DD: string
}

export function datePartsInZone(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const YYYY = get('year')
  return { YYYY, YY: YYYY.slice(-2), MM: get('month'), DD: get('day') }
}

/**
 * The counter resets per period. The period is the finest date token in the format:
 * day if {DD} is present, else month, else year, else never.
 */
export function ticketPeriodKey(format: string, parts: DateParts): string {
  if (format.includes('{DD}')) return `D:${parts.YYYY}${parts.MM}${parts.DD}`
  if (format.includes('{MM}')) return `M:${parts.YYYY}${parts.MM}`
  if (format.includes('{YYYY}') || format.includes('{YY}')) return `Y:${parts.YYYY}`
  return 'ALL'
}

export function formatTicketNumber(format: string, prefix: string, parts: DateParts, seq: number): string {
  return format
    .replace(/\{PREFIX\}/g, prefix)
    .replace(/\{YYYY\}/g, parts.YYYY)
    .replace(/\{YY\}/g, parts.YY)
    .replace(/\{MM\}/g, parts.MM)
    .replace(/\{DD\}/g, parts.DD)
    .replace(/\{SEQ(?::(\d))?\}/g, (_m, width?: string) => String(seq).padStart(width ? Number(width) : 1, '0'))
}

/** Regex that matches ticket numbers produced by `format` (used to find IDs in email subjects). */
export function ticketNumberRegex(format: string, prefix: string): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let pattern = ''
  const tokenRe = /\{(PREFIX|YYYY|YY|MM|DD|SEQ(?::\d)?)\}/g
  let last = 0
  for (const m of format.matchAll(tokenRe)) {
    pattern += escape(format.slice(last, m.index))
    const tok = m[1]
    if (tok === 'PREFIX') pattern += escape(prefix)
    else if (tok === 'YYYY') pattern += '\\d{4}'
    else if (tok === 'YY' || tok === 'MM' || tok === 'DD') pattern += '\\d{2}'
    else pattern += '\\d+'
    last = (m.index ?? 0) + m[0].length
  }
  pattern += escape(format.slice(last))
  return new RegExp(`\\[(${pattern})\\]`, 'i')
}
