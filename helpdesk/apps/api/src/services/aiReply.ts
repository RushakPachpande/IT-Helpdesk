export const SYSTEM_PROMPT = `You triage IT support tickets. Reply with JSON only, no prose:
{"summary": "<one or two sentences describing the problem>", "priority": "Low" | "Medium" | "High" | "Critical"}
Use Critical only for outages, security incidents or many users blocked. Use High when one person cannot work.`

export interface AiResult {
  summary: string
  priority: string | null
}

/** Extract the JSON object from a model reply; tolerant of code fences and surrounding prose. */
export function parseAiReply(content: string): AiResult | null {
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    const summary = typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 1000) : ''
    const priority = ['Low', 'Medium', 'High', 'Critical'].find((p) => p.toLowerCase() === String(obj.priority ?? '').toLowerCase()) ?? null
    return summary ? { summary, priority } : null
  } catch {
    return null
  }
}
