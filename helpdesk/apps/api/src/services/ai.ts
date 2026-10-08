import { prisma } from '../db.js'
import { getSettings } from './settings.js'
import { publish } from './events.js'
import { parseAiReply, SYSTEM_PROMPT } from './aiReply.js'

const ENDPOINTS = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
} as const

/** Summarize a ticket. Failures are logged and never block ticket handling. */
export async function summarizeTicket(ticketId: string): Promise<void> {
  const settings = await getSettings()
  if (!settings.ai.enabled || !settings.ai.apiKey) return
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { priority: true } })
  if (!ticket) return

  const res = await fetch(ENDPOINTS[settings.ai.provider], {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.ai.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.ai.model,
      temperature: 0.2,
      max_tokens: 300,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Subject: ${ticket.subject}\n\n${ticket.description.slice(0, 6000)}` },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`AI provider returned ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const parsed = parseAiReply(json.choices?.[0]?.message?.content ?? '')
  if (!parsed) throw new Error('AI reply was not valid JSON')

  const data: { aiSummary: string; aiPriority: string | null; priorityId?: string } = {
    aiSummary: parsed.summary,
    aiPriority: parsed.priority,
  }
  // Only override priority if nobody has changed it since creation.
  if (settings.ai.applySuggestedPriority && parsed.priority) {
    const changed = await prisma.auditLog.findFirst({ where: { entityId: ticketId, action: 'ticket.updated' } })
    const p = await prisma.priority.findFirst({ where: { name: { equals: parsed.priority, mode: 'insensitive' }, active: true } })
    if (!changed && p) data.priorityId = p.id
  }
  await prisma.ticket.update({ where: { id: ticketId }, data })
  await publish({ type: 'ticket.changed', ticketId, requesterId: ticket.requesterId, staffOnly: true })
}
