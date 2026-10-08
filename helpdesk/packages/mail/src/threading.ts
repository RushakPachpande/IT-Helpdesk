/** Extract `<id@host>` tokens from In-Reply-To / References header values. */
export function parseMessageIds(header: string | null | undefined): string[] {
  if (!header) return []
  return [...header.matchAll(/<[^<>\s]+>/g)].map((m) => m[0])
}

/** Build a References list for a reply: previous references plus the message being answered, de-duplicated. */
export function buildReferences(previous: string[] | undefined, inReplyTo: string | null | undefined): string[] {
  const refs = [...(previous ?? [])]
  if (inReplyTo && !refs.includes(inReplyTo)) refs.push(inReplyTo)
  // Keep the header reasonably short; the first and latest ids matter most.
  return refs.length > 20 ? [refs[0], ...refs.slice(-19)] : refs
}

/** Strip Re:/Fw:/Fwd: prefixes for display and matching. */
export function baseSubject(subject: string): string {
  let s = subject.trim()
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|wg)\s*:\s*/i, '')
    if (next === s) return s
    s = next
  }
}
