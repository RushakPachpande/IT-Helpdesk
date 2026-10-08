import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma, type Prisma } from '../db.js'
import { requireAdmin } from '../auth/session.js'

export async function auditRoutes(app: FastifyInstance) {
  app.get('/api/admin/audit', { preHandler: requireAdmin }, async (req) => {
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        entityType: z.string().optional(),
        action: z.string().optional(),
      })
      .parse(req.query)
    const where: Prisma.AuditLogWhereInput = {}
    if (q.entityType) where.entityType = q.entityType
    if (q.action) where.action = { contains: q.action }
    const pageSize = 50
    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { name: true, email: true } } },
      }),
    ])
    return { entries, total, page: q.page, pageSize }
  })
}
