import { config } from './config.js'
import { prisma } from './db.js'
import { getBoss, QUEUES, stopBoss } from './services/boss.js'
import { syncActiveMailbox } from './services/ingest.js'
import { sendOutbound } from './services/sender.js'
import { summarizeTicket } from './services/ai.js'
import { assertEncryptionKey } from './crypto.js'

assertEncryptionKey()

const log = (...args: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...args)

const boss = await getBoss()

// Every minute; the handler itself honours the admin's poll interval setting.
await boss.schedule(QUEUES.mailSync, '* * * * *', { force: false }, { tz: config.timezone, retryLimit: 0 })
await boss.schedule(QUEUES.cleanup, '15 3 * * *', {}, { tz: config.timezone })

await boss.work<{ force?: boolean }>(QUEUES.mailSync, async ([job]) => {
  await syncActiveMailbox(Boolean(job?.data?.force)).catch((err) => log('mail sync failed:', err instanceof Error ? err.message : err))
})

/** Log failures before pg-boss records them and schedules a retry. */
function logged<T>(label: string, fn: (data: T) => Promise<void>) {
  return async ([job]: { data: T }[]) => {
    try {
      await fn(job.data)
    } catch (err) {
      log(`${label} failed:`, err instanceof Error ? err.message : err)
      throw err
    }
  }
}

await boss.work<{ outboundId: string }>(QUEUES.mailSend, { localConcurrency: 2 }, logged('send email', (d) => sendOutbound(d.outboundId)))

await boss.work<{ ticketId: string }>(QUEUES.aiSummarize, logged('AI summary', (d) => summarizeTicket(d.ticketId)))

await boss.work(QUEUES.cleanup, async () => {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  const cutoff = new Date(Date.now() - 90 * 86400_000)
  await prisma.mailboxEvent.deleteMany({ where: { createdAt: { lt: cutoff } } })
  log(`cleanup: removed ${count} expired sessions`)
})

log('started; queues:', Object.values(QUEUES).join(', '))

async function shutdown() {
  log('stopping')
  await stopBoss()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
