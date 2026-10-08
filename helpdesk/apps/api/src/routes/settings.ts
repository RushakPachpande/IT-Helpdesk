import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { datePartsInZone, formatTicketNumber, settingsSchema } from '@helpdesk/shared'
import { parse } from '../http.js'
import { requireAdmin, requireAuth } from '../auth/session.js'
import { getPublicSettings, saveSettings } from '../services/settings.js'
import { audit } from '../services/audit.js'
import { config } from '../config.js'

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/admin/settings', { preHandler: requireAdmin }, async () => {
    return { settings: await getPublicSettings(), timezone: config.timezone }
  })

  app.put('/api/admin/settings', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const body = parse(settingsSchema, req.body)
    await saveSettings(body)
    await audit(admin.id, 'settings.updated', 'settings', null, {
      ticketId: body.ticketId,
      ai: { enabled: body.ai.enabled, provider: body.ai.provider, model: body.ai.model, apiKeyChanged: Boolean(body.ai.apiKey) },
    })
    return { settings: await getPublicSettings() }
  })

  app.get('/api/admin/settings/ticket-id-preview', { preHandler: requireAdmin }, async (req) => {
    const q = z.object({ format: z.string().max(60), prefix: z.string().max(10) }).parse(req.query)
    const parts = datePartsInZone(new Date(), config.timezone)
    return { preview: formatTicketNumber(q.format, q.prefix, parts, 1) }
  })
}
