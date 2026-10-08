import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { errorHandler } from './http.js'
import { registerSessionHooks } from './auth/session.js'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { domainRoutes } from './routes/domains.js'
import { metaRoutes } from './routes/meta.js'
import { ticketRoutes } from './routes/tickets.js'
import { settingsRoutes } from './routes/settings.js'
import { mailboxRoutes } from './routes/mailbox.js'
import { auditRoutes } from './routes/audit.js'

export async function buildApp() {
  const app = Fastify({
    logger: config.isProduction
      ? { level: 'info' }
      : { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
    trustProxy: false,
    bodyLimit: 2 * 1024 * 1024,
  })

  app.setErrorHandler(errorHandler)
  await app.register(helmet, {
    // Served over plain HTTP on the LAN: no HSTS / upgrade-insecure-requests.
    hsts: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'upgrade-insecure-requests': null,
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
      },
    },
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
  })
  await app.register(cookie)
  await app.register(rateLimit, { global: false })
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 20, fields: 20 } })

  registerSessionHooks(app)

  app.get('/api/health', async () => ({ ok: true }))
  await app.register(authRoutes)
  await app.register(userRoutes)
  await app.register(domainRoutes)
  await app.register(metaRoutes)
  await app.register(ticketRoutes)
  await app.register(settingsRoutes)
  await app.register(mailboxRoutes)
  await app.register(auditRoutes)

  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDist })
    // SPA fallback: client routes return index.html; missing assets stay 404 so stale bundles fail loudly.
    app.setNotFoundHandler((req, reply) => {
      const pathname = req.url.split('?')[0]
      if (req.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/socket.io') && !pathname.startsWith('/assets/')) {
        return reply.type('text/html').sendFile('index.html')
      }
      return reply.status(404).send({ error: 'Not found' })
    })
  } else {
    app.log.warn(`Web build not found at ${config.webDist}; run "pnpm build" or use the Vite dev server`)
  }

  return app
}
