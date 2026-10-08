import { mergeSettings, type Settings } from '@helpdesk/shared'
import { prisma } from '../db.js'
import { decrypt, encrypt } from '../crypto.js'

const KEY = 'app'
let cache: { value: Settings; at: number } | null = null
const TTL_MS = 5_000

/** Settings with secrets decrypted (server-side use only). */
export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  const row = await prisma.setting.findUnique({ where: { key: KEY } })
  const value = mergeSettings(row?.value)
  if (value.ai.apiKey) {
    try {
      value.ai.apiKey = decrypt(value.ai.apiKey)
    } catch {
      value.ai.apiKey = undefined
    }
  }
  cache = { value, at: Date.now() }
  return value
}

/** Settings safe to send to the admin UI. */
export async function getPublicSettings(): Promise<Settings & { ai: Settings['ai'] & { hasApiKey: boolean } }> {
  const s = await getSettings()
  return { ...s, ai: { ...s.ai, apiKey: undefined, hasApiKey: Boolean(s.ai.apiKey) } }
}

/** Save settings. An empty/omitted ai.apiKey keeps the existing key; "__clear__" removes it. */
export async function saveSettings(next: Settings): Promise<void> {
  const current = await getSettings()
  let apiKey = current.ai.apiKey
  if (next.ai.apiKey === '__clear__') apiKey = undefined
  else if (next.ai.apiKey) apiKey = next.ai.apiKey
  const stored = { ...next, ai: { ...next.ai, apiKey: apiKey ? encrypt(apiKey) : undefined } }
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: stored as object },
    update: { value: stored as object },
  })
  cache = null
}
