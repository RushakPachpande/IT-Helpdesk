import { PgBoss } from 'pg-boss'
import { config } from '../config.js'

export const QUEUES = {
  mailSync: 'mail-sync',
  mailSend: 'mail-send',
  aiSummarize: 'ai-summarize',
  cleanup: 'cleanup',
} as const

let boss: PgBoss | null = null
let starting: Promise<PgBoss> | null = null

export function getBoss(): Promise<PgBoss> {
  if (boss) return Promise.resolve(boss)
  starting ??= (async () => {
    const b = new PgBoss(config.databaseUrl)
    b.on('error', (err) => console.error('[pg-boss]', err))
    await b.start()
    for (const name of Object.values(QUEUES)) {
      try {
        await b.createQueue(name)
      } catch {
        /* queue already exists */
      }
    }
    boss = b
    return b
  })()
  return starting
}

export async function stopBoss(): Promise<void> {
  if (boss) await boss.stop({ graceful: true }).catch(() => undefined)
  boss = null
  starting = null
}

export async function enqueue(queue: string, data: object, options: Record<string, unknown> = {}): Promise<void> {
  const b = await getBoss()
  await b.send(queue, data, { retryLimit: 5, retryDelay: 30, retryBackoff: true, ...options })
}
