import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createUserSchema, isEmailDomainAllowed, resetPasswordSchema, updateUserSchema } from '@helpdesk/shared'
import { prisma, type Prisma } from '../db.js'
import { badRequest, conflict, notFound, parse } from '../http.js'
import { hashPassword, requireAdmin, requireAuth, requireStaff } from '../auth/session.js'
import { generateTemporaryPassword } from '../crypto.js'
import { audit } from '../services/audit.js'

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  department: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
} satisfies Prisma.UserSelect

export async function assertDomainAllowed(email: string) {
  const rules = await prisma.allowedDomain.findMany()
  if (!isEmailDomainAllowed(email, rules)) {
    throw badRequest(`The domain of ${email} is not in the allowed domains list`, 'DOMAIN_NOT_ALLOWED')
  }
}

export async function userRoutes(app: FastifyInstance) {
  app.get('/api/admin/users', { preHandler: requireAdmin }, async (req) => {
    const q = z
      .object({ q: z.string().optional(), status: z.string().optional(), role: z.string().optional() })
      .parse(req.query)
    const where: Prisma.UserWhereInput = {}
    if (q.q) where.OR = [{ email: { contains: q.q, mode: 'insensitive' } }, { name: { contains: q.q, mode: 'insensitive' } }]
    if (q.status) where.status = q.status as Prisma.UserWhereInput['status']
    if (q.role) where.role = q.role as Prisma.UserWhereInput['role']
    const users = await prisma.user.findMany({ where, select: userSelect, orderBy: [{ status: 'asc' }, { name: 'asc' }] })
    return { users }
  })

  app.post('/api/admin/users', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const body = parse(createUserSchema, req.body)
    await assertDomainAllowed(body.email)
    const existing = await prisma.user.findUnique({ where: { email: body.email } })
    const temporaryPassword = body.temporaryPassword ?? generateTemporaryPassword()
    const data = {
      name: body.name,
      role: body.role,
      department: body.department ?? null,
      status: 'ACTIVE' as const,
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
    }
    let user
    if (existing) {
      if (existing.status !== 'PLACEHOLDER') throw conflict('A user with this email already exists')
      // Activate a placeholder created from an inbound email; their tickets stay linked.
      user = await prisma.user.update({ where: { id: existing.id }, data, select: userSelect })
    } else {
      user = await prisma.user.create({ data: { email: body.email, ...data }, select: userSelect })
    }
    await audit(admin.id, existing ? 'user.activated_placeholder' : 'user.created', 'user', user.id, {
      email: user.email,
      role: user.role,
    })
    return { user, temporaryPassword }
  })

  app.patch('/api/admin/users/:id', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const { id } = req.params as { id: string }
    const body = parse(updateUserSchema, req.body)
    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) throw notFound('User not found')
    if (id === admin.id && ((body.role && body.role !== 'ADMIN') || (body.status && body.status !== 'ACTIVE'))) {
      throw badRequest('You cannot remove your own admin access or deactivate yourself')
    }
    if (body.status === 'ACTIVE' && !target.passwordHash) {
      throw badRequest('Set a temporary password (reset password) before activating this user')
    }
    const user = await prisma.user.update({ where: { id }, data: body, select: userSelect })
    if (body.status && body.status !== 'ACTIVE') await prisma.session.deleteMany({ where: { userId: id } })
    await audit(admin.id, 'user.updated', 'user', id, body)
    return { user }
  })

  app.post('/api/admin/users/:id/reset-password', { preHandler: requireAdmin }, async (req) => {
    const admin = requireAuth(req)
    const { id } = req.params as { id: string }
    const body = parse(resetPasswordSchema, req.body ?? {})
    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) throw notFound('User not found')
    if (target.status === 'PLACEHOLDER') await assertDomainAllowed(target.email)
    const temporaryPassword = body.temporaryPassword ?? generateTemporaryPassword()
    const user = await prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        status: target.status === 'PLACEHOLDER' ? 'ACTIVE' : target.status,
      },
      select: userSelect,
    })
    await prisma.session.deleteMany({ where: { userId: id } })
    await audit(admin.id, 'user.password_reset', 'user', id)
    return { user, temporaryPassword }
  })

  /** Staff need the agent list for assignment. */
  app.get('/api/agents', { preHandler: requireStaff }, async () => {
    const agents = await prisma.user.findMany({
      where: { role: { in: ['AGENT', 'ADMIN'] }, status: 'ACTIVE' },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    })
    return { agents }
  })
}
