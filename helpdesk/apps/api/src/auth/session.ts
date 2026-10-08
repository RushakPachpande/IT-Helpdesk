import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import argon2 from 'argon2'
import type { Role } from '@helpdesk/shared'
import { prisma, type User } from '../db.js'
import { config } from '../config.js'
import { randomToken, sha256 } from '../crypto.js'
import { forbidden, HttpError } from '../http.js'

export const SESSION_COOKIE = 'hd_session'
export const CSRF_COOKIE = 'hd_csrf'
export const CSRF_HEADER = 'x-csrf-token'
const MAX_FAILED_LOGINS = 5
const LOCK_MINUTES = 15

export type SessionUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'status' | 'mustChangePassword' | 'department'>

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null
    sessionId: string | null
  }
}

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id })
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw).catch(() => false)

const cookieBase = () => ({ path: '/', sameSite: 'lax' as const, secure: config.cookieSecure })

export async function createSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
  const token = randomToken()
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000)
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      ip: req.ip,
      userAgent: req.headers['user-agent']?.slice(0, 300),
    },
  })
  reply.setCookie(SESSION_COOKIE, token, { ...cookieBase(), httpOnly: true, expires: expiresAt })
  reply.setCookie(CSRF_COOKIE, randomToken(16), { ...cookieBase(), httpOnly: false, expires: expiresAt })
}

export async function destroySession(req: FastifyRequest, reply: FastifyReply) {
  if (req.sessionId) await prisma.session.delete({ where: { id: req.sessionId } }).catch(() => undefined)
  reply.clearCookie(SESSION_COOKIE, { path: '/' })
  reply.clearCookie(CSRF_COOKIE, { path: '/' })
}

/** Look up the user for a raw session token (used by HTTP and Socket.IO). */
export async function userFromToken(token: string | undefined): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: { select: { id: true, email: true, name: true, role: true, status: true, mustChangePassword: true, department: true } },
    },
  })
  if (!session || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') return null
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined)
  }
  return { user: session.user, sessionId: session.id }
}

const PASSWORD_CHANGE_ALLOWED = new Set(['/api/auth/me', '/api/auth/change-password', '/api/auth/logout'])
const CSRF_EXEMPT = new Set(['/api/auth/login'])

export function registerSessionHooks(app: FastifyInstance) {
  app.decorateRequest('user', null)
  app.decorateRequest('sessionId', null)

  app.addHook('onRequest', async (req) => {
    const found = await userFromToken(req.cookies[SESSION_COOKIE])
    req.user = found?.user ?? null
    req.sessionId = found?.sessionId ?? null

    const path = req.url.split('?')[0]
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    if (unsafe && path.startsWith('/api/') && !CSRF_EXEMPT.has(path)) {
      const header = req.headers[CSRF_HEADER]
      if (!header || header !== req.cookies[CSRF_COOKIE]) throw forbidden('Invalid CSRF token', 'CSRF')
    }
  })
}

export function requireAuth(req: FastifyRequest) {
  if (!req.user) throw new HttpError(401, 'Not signed in', 'UNAUTHENTICATED')
  const path = req.url.split('?')[0]
  if (req.user.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(path)) {
    throw forbidden('You must change your password first', 'PASSWORD_CHANGE_REQUIRED')
  }
  return req.user
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    const user = requireAuth(req)
    if (!roles.includes(user.role)) throw forbidden()
  }
}

export const requireStaff = requireRole('AGENT', 'ADMIN')
export const requireAdmin = requireRole('ADMIN')

export async function authenticate(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } })
  const invalid = new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS')
  if (!user || !user.passwordHash) {
    await argon2.hash(password).catch(() => undefined) // keep timing similar for unknown users
    throw invalid
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(423, `Account locked after too many failed attempts. Try again after ${user.lockedUntil.toLocaleTimeString()}.`, 'LOCKED')
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    const failed = user.failedLoginCount + 1
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    })
    throw invalid
  }
  if (user.status !== 'ACTIVE') throw new HttpError(403, 'This account is not active. Contact IT.', 'INACTIVE')
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  })
  return user
}
