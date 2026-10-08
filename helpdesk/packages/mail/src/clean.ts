/**
 * Turns an email body into the new message only: drops signatures, quoted history and images.
 * Ported from the n8n "Extract & Filter Email Data" node and the strip-signatures plan.
 */

const HTML_CUT_MARKERS: RegExp[] = [
  /<div[^>]*\bid=["']?(?:x_)?divRplyFwdMsg\b/i,
  /<div[^>]*\bid=["']?(?:x_)?appendonsend\b/i,
  /<hr[^>]*\bid=["']?(?:x_)?stopSpelling\b/i,
  /<[a-z]+[^>]*\bid=["']?(?:x_)?Signature\b/i,
  /<[a-z]+[^>]*\bid=["']?(?:x_)?ms-outlook-mobile-signature\b/i,
  /<[a-z]+[^>]*\bclass=["'][^"']*\bgmail_signature\b/i,
  /<[a-z]+[^>]*\bclass=["'][^"']*\bgmail_quote\b/i,
  /<blockquote\b/i,
]

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, code: string) => {
    const lower = code.toLowerCase()
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16))
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10))
    return ENTITIES[lower] ?? m
  })
}

function cutAtFirstMarker(html: string): string {
  let cut = html.length
  for (const re of HTML_CUT_MARKERS) {
    const m = re.exec(html)
    if (m && m.index < cut) cut = m.index
  }
  return html.slice(0, cut)
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|table)>/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
}

const IMAGE_PLACEHOLDERS = /\[cid:[^\]]*\]|\[image:[^\]]*\]|\[image\]/gi

function cutQuotedHistory(lines: string[]): string[] {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line)) return lines.slice(0, i)
    if (/^_{10,}$/.test(line)) return lines.slice(0, i)
    if (/^On .+ wrote:$/i.test(line)) return lines.slice(0, i)
    // Gmail sometimes wraps "On <date>, <name> wrote:" over two lines.
    if (/^On .+/i.test(line) && i + 1 < lines.length && /wrote:$/i.test(lines[i + 1].trim()) && line.length < 120) {
      return lines.slice(0, i)
    }
    if (/^From:\s.+/i.test(line)) {
      for (let j = i + 1; j <= i + 4 && j < lines.length; j++) {
        if (/^(Sent|Date):/i.test(lines[j].trim())) return lines.slice(0, i)
      }
    }
  }
  return lines.filter((l) => !l.trimStart().startsWith('>'))
}

const SIGN_OFF =
  /^(--|regards|best regards|kind regards|warm regards|many thanks|thanks|thank you|thanks & regards|thanks and regards|cheers|sincerely|sent from my .+|get outlook for .+)[,.!]?$/i

function cutSignOff(lines: string[]): string[] {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length === 0 || line.length > 40) continue
    if (!SIGN_OFF.test(line)) continue
    const hasContentAbove = lines.slice(0, i).some((l) => l.trim().length > 0)
    if (hasContentAbove) return lines.slice(0, i)
  }
  return lines
}

function tidy(lines: string[], maxLength: number): string {
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.replace(/[ \t\u00a0]+/g, ' ').trim()
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue
    out.push(line)
  }
  while (out.length && out[out.length - 1] === '') out.pop()
  let text = out.join('\n')
  if (text.length > maxLength) text = text.slice(0, maxLength - 3) + '...'
  return text
}

export interface CleanBodyInput {
  html?: string | null
  text?: string | null
}

export function cleanEmailBody(input: CleanBodyInput, maxLength = 10000): string {
  const fromHtml = input.html ? htmlToText(cutAtFirstMarker(input.html)) : null
  const source = fromHtml ?? input.text ?? ''
  const lines = source.replace(/\r\n?/g, '\n').replace(IMAGE_PLACEHOLDERS, '').split('\n')
  const cleaned = tidy(cutSignOff(cutQuotedHistory(lines)), maxLength)
  if (cleaned) return cleaned
  // Cleaning removed everything: fall back to the plain text version, lightly tidied.
  if (input.text) {
    const fallback = tidy(input.text.replace(/\r\n?/g, '\n').replace(IMAGE_PLACEHOLDERS, '').split('\n'), maxLength)
    if (fallback) return fallback
  }
  return '(no content)'
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Plain text (chat message / template) to simple email HTML. */
export function textToEmailHtml(text: string): string {
  const body = escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px 0">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937">${body}</div>`
}
