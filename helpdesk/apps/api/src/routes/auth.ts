import type { FastifyInstance } from 'fastify'
import { changePasswordSchema, loginSchema } from '@helpdesk/shared'
import { prisma } from '../db.js'
import { badRequest, parse } from '../http.js'
import {
  authenticate,
  createSession,
  destroySession,
  hashPassword,
  requireAuth,
  verifyPassword,
} from '../auth/session.js'
import { audit } from '../services/audit.js'

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(loginSchema, req.body)
      const user = await authenticate(body.email, body.password)
      await createSession(req, reply, user.id)
      await audit(user.id, 'auth.login', 'user', user.id, { ip: req.ip })
      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        },
      }
    },
  )

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(req, reply)
    return { ok: true }
  })

  app.get('/api/auth/me', async (req) => {
    const user = requireAuth(req)
    return { user }
  })

  app.post('/api/auth/change-password', async (req) => {
    const sessionUser = requireAuth(req)
    const body = parse(changePasswordSchema, req.body)
    const user = await prisma.user.findUniqueOrThrow({ where: { id: sessionUser.id } })
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw badRequest('Current password is incorrect')
    }
    if (body.currentPassword === body.newPassword) throw badRequest('New password must be different')
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false },
      }),
      // Sign out other sessions after a password change.
      prisma.session.deleteMany({ where: { userId: user.id, id: { not: req.sessionId ?? '' } } }),
    ])
    await audit(user.id, 'auth.password_changed', 'user', user.id)
    return { ok: true }
  })
}
