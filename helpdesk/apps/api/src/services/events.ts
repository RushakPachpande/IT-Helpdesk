import pg from 'pg'
import { config } from '../config.js'

/**
 * Cross-process realtime events. The worker and API both publish with Postgres NOTIFY;
 * the API process LISTENs and forwards to Socket.IO rooms.
 */
export const CHANNEL = 'helpdesk_events'

export interface AppEvent {
  type: 'ticket.changed' | 'ticket.message' | 'mailbox.changed'
  ticketId?: string
  requesterId?: string | null
  /** True if only staff may see it (internal notes). */
  staffOnly?: boolean
}

let pool: pg.Pool | null = null

function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: config.databaseUrl, max: 2 })
  return pool
}

export async function publish(event: AppEvent): Promise<void> {
  try {
    await getPool().query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)])
  } catch (err) {
    console.error('publish event failed', err)
  }
}

export async function subscribe(onEvent: (e: AppEvent) => void): Promise<() => Promise<void>> {
  let client: pg.Client | null = null
  let stopped = false

  const connect = async () => {
    client = new pg.Client({ connectionString: config.databaseUrl })
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return
      try {
        onEvent(JSON.parse(msg.payload))
      } catch {
        /* ignore malformed payloads */
      }
    })
    client.on('error', () => {
      if (!stopped) setTimeout(() => void connect().catch(() => undefined), 2000)
    })
    await client.connect()
    await client.query(`LISTEN ${CHANNEL}`)
  }

  await connect()
  return async () => {
    stopped = true
    await client?.end().catch(() => undefined)
  }
}
