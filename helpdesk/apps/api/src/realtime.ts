import type { FastifyInstance } from 'fastify'
import { Server } from 'socket.io'
import { EVENTS, isStaff } from '@helpdesk/shared'
import { SESSION_COOKIE, userFromToken } from './auth/session.js'
import { subscribe } from './services/events.js'

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

/** Socket.IO rooms: "staff" for agents/admins, "user:<id>" for each signed-in user. */
export async function attachRealtime(app: FastifyInstance): Promise<() => Promise<void>> {
  const io = new Server(app.server, { path: '/socket.io', serveClient: false })

  io.use(async (socket, next) => {
    const found = await userFromToken(readCookie(socket.handshake.headers.cookie, SESSION_COOKIE)).catch(() => null)
    if (!found || found.user.mustChangePassword) return next(new Error('unauthorized'))
    socket.data.user = found.user
    next()
  })

  io.on('connection', (socket) => {
    const user = socket.data.user
    void socket.join(`user:${user.id}`)
    if (isStaff(user.role)) void socket.join('staff')
  })

  const unsubscribe = await subscribe((event) => {
    if (event.type === 'mailbox.changed') {
      io.to('staff').emit(EVENTS.mailboxChanged, {})
      return
    }
    const payload = { ticketId: event.ticketId }
    const name = event.type === 'ticket.message' ? EVENTS.ticketMessage : EVENTS.ticketChanged
    io.to('staff').emit(name, payload)
    io.to('staff').emit(EVENTS.queueChanged, payload)
    if (!event.staffOnly && event.requesterId) io.to(`user:${event.requesterId}`).emit(name, payload)
  })

  return async () => {
    await unsubscribe()
    io.disconnectSockets(true)
  }
}
