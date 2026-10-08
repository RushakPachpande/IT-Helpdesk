import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'
import { EVENTS } from '@helpdesk/shared'

/** Live updates: the server only says "ticket X changed"; we refetch what is on screen. */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!enabled) return
    const socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] })
    const onTicket = ({ ticketId }: { ticketId?: string }) => {
      void qc.invalidateQueries({ queryKey: ['tickets'] })
      if (ticketId) void qc.invalidateQueries({ queryKey: ['ticket', ticketId] })
    }
    socket.on(EVENTS.ticketChanged, onTicket)
    socket.on(EVENTS.ticketMessage, onTicket)
    socket.on(EVENTS.queueChanged, () => void qc.invalidateQueries({ queryKey: ['counts'] }))
    socket.on(EVENTS.mailboxChanged, () => void qc.invalidateQueries({ queryKey: ['mailbox'] }))
    return () => {
      socket.disconnect()
    }
  }, [enabled, qc])
}
