import type { FastifyInstance } from 'fastify'
import { domainSchema, isValidDomain, normalizeDomain } from '@helpdesk/shared'
import { prisma } from '../db.js'
import { badRequest, conflict, parse } from '../http.js'
import { requireAdmin, requireAuth } from '../auth/session.js'
import { audit } from '../services/audit.js'

export async function domainRoutes(app: FastifyInstance) {
  app.get('/api/admin/domains', { preHandler: requireAdmin }, async () => {
    return { domains: await prisma.allowedDomain.findMany({ orderBy: { domain: 'asc' } }) }
  })

  app.post('/api/admin/domains', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const body = parse(domainSchema, req.body)
    const domain = normalizeDomain(body.domain)
    if (!isValidDomain(domain)) throw badRequest('Enter a valid domain such as company.com')
    if (await prisma.allowedDomain.findUnique({ where: { domain } })) throw conflict('Domain already added')
    const row = await prisma.allowedDomain.create({ data: { domain, includeSubdomains: body.includeSubdomains } })
    await audit(admin.id, 'domain.added', 'domain', row.id, { domain, includeSubdomains: body.includeSubdomains })
    return { domain: row }
  })

  app.patch('/api/admin/domains/:id', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const { id } = req.params as { id: string }
    const body = parse(domainSchema.pick({ includeSubdomains: true }), req.body)
    const row = await prisma.allowedDomain.update({ where: { id }, data: body })
    await audit(admin.id, 'domain.updated', 'domain', id, body)
    return { domain: row }
  })

  app.delete('/api/admin/domains/:id', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const { id } = req.params as { id: string }
    if ((await prisma.allowedDomain.count()) <= 1) {
      throw badRequest('Keep at least one allowed domain, otherwise no new users can be created')
    }
    const row = await prisma.allowedDomain.delete({ where: { id } })
    await audit(admin.id, 'domain.removed', 'domain', id, { domain: row.domain })
    return { ok: true }
  })
}
