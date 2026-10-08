import type { FastifyInstance } from 'fastify'
import { categorySchema, prioritySchema } from '@helpdesk/shared'
import { prisma } from '../db.js'
import { badRequest, parse } from '../http.js'
import { requireAdmin, requireAuth } from '../auth/session.js'
import { getSettings } from '../services/settings.js'
import { audit } from '../services/audit.js'

export async function metaRoutes(app: FastifyInstance) {
  /** Lists every signed-in user needs to build forms. */
  app.get('/api/meta', async (req) => {
    const user = requireAuth(req)
    const staff = user.role !== 'EMPLOYEE'
    const [categories, priorities, settings] = await Promise.all([
      prisma.category.findMany({ where: staff ? {} : { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.priority.findMany({ where: staff ? {} : { active: true }, orderBy: { rank: 'asc' } }),
      getSettings(),
    ])
    return {
      categories,
      priorities,
      attachments: {
        maxFileMb: settings.attachments.maxFileMb,
        maxFilesPerMessage: settings.attachments.maxFilesPerMessage,
        allowedMimeTypes: settings.attachments.allowedMimeTypes,
      },
    }
  })

  app.post('/api/admin/categories', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const body = parse(categorySchema, req.body)
    const category = await prisma.category.create({ data: body })
    await audit(admin.id, 'category.created', 'category', category.id, body)
    return { category }
  })

  app.patch('/api/admin/categories/:id', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const { id } = req.params as { id: string }
    const body = parse(categorySchema.partial(), req.body)
    const category = await prisma.category.update({ where: { id }, data: body })
    await audit(admin.id, 'category.updated', 'category', id, body)
    return { category }
  })

  app.post('/api/admin/priorities', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const body = parse(prioritySchema, req.body)
    const priority = await prisma.$transaction(async (tx) => {
      if (body.isDefault) await tx.priority.updateMany({ data: { isDefault: false } })
      return tx.priority.create({ data: body })
    })
    await audit(admin.id, 'priority.created', 'priority', priority.id, body)
    return { priority }
  })

  app.patch('/api/admin/priorities/:id', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const { id } = req.params as { id: string }
    const body = parse(prioritySchema.partial(), req.body)
    if (body.isDefault === false) {
      const current = await prisma.priority.findUnique({ where: { id } })
      if (current?.isDefault) throw badRequest('Mark another priority as default instead')
    }
    const priority = await prisma.$transaction(async (tx) => {
      if (body.isDefault) await tx.priority.updateMany({ where: { id: { not: id } }, data: { isDefault: false } })
      return tx.priority.update({ where: { id }, data: body })
    })
    await audit(admin.id, 'priority.updated', 'priority', id, body)
    return { priority }
  })
}
