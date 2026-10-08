import { datePartsInZone, formatTicketNumber, ticketPeriodKey } from '@helpdesk/shared'
import { prisma } from '../db.js'
import { config } from '../config.js'
import { getSettings } from './settings.js'

/** Atomically take the next counter value for a period. Safe under concurrent API + worker use. */
export async function nextCounter(periodKey: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ value: number }[]>`
    INSERT INTO "TicketIdCounter" ("periodKey", "value") VALUES (${periodKey}, 1)
    ON CONFLICT ("periodKey") DO UPDATE SET "value" = "TicketIdCounter"."value" + 1
    RETURNING "value"`
  return Number(rows[0].value)
}

export async function nextTicketNumber(now = new Date()): Promise<string> {
  const { ticketId } = await getSettings()
  const parts = datePartsInZone(now, config.timezone)
  const periodKey = `${ticketId.format}|${ticketPeriodKey(ticketId.format, parts)}`
  // If the admin changed the format, older numbers may collide: skip forward until free.
  for (let i = 0; i < 50; i++) {
    const candidate = formatTicketNumber(ticketId.format, ticketId.prefix, parts, await nextCounter(periodKey))
    const exists = await prisma.ticket.findUnique({ where: { ticketNumber: candidate }, select: { id: true } })
    if (!exists) return candidate
  }
  throw new Error('Could not allocate a unique ticket number; check the ticket ID format')
}
