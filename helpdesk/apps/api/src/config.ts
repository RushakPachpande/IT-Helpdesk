import { config as loadDotenv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(here, '../../..')

// Local development reads helpdesk/.env; in Docker the variables come from compose.
loadDotenv({ path: path.join(REPO_ROOT, '.env'), quiet: true })

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required environment variable ${name} (see .env.example)`)
  return v
}

function resolveDir(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p)
}

export const config = {
  port: Number(process.env.APP_PORT ?? 8080),
  publicUrl: (process.env.APP_PUBLIC_URL ?? 'http://localhost:8080').replace(/\/$/, ''),
  oauthRedirectBase: (process.env.OAUTH_REDIRECT_BASE ?? 'http://localhost:8080').replace(/\/$/, ''),
  timezone: process.env.APP_TIMEZONE ?? 'Asia/Kolkata',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  databaseUrl: required('DATABASE_URL'),
  encryptionKey: process.env.APP_ENCRYPTION_KEY ?? '',
  uploadDir: resolveDir(process.env.UPLOAD_DIR ?? './data/uploads'),
  webDist: process.env.WEB_DIST ? resolveDir(process.env.WEB_DIST) : path.join(REPO_ROOT, 'apps/web/dist'),
  isProduction: process.env.NODE_ENV === 'production',
  microsoft: {
    clientId: process.env.MS_CLIENT_ID ?? '',
    clientSecret: process.env.MS_CLIENT_SECRET ?? '',
    tenantId: process.env.MS_TENANT_ID || 'organizations',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  },
}
