import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { config } from './config.js'

function key(): Buffer {
  const k = Buffer.from(config.encryptionKey, 'base64')
  if (k.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key (see .env.example)')
  }
  return k
}

/** Fail at startup rather than on the first mailbox connect. */
export function assertEncryptionKey(): void {
  key()
}

/** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12))
  decipher.setAuthTag(buf.subarray(12, 28))
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8')
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Readable temporary password that satisfies the password policy. */
export function generateTemporaryPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnpqrstuvwxyz'
  const digits = '23456789'
  const all = upper + lower + digits
  const pick = (set: string) => set[randomBytes(1)[0] % set.length]
  const chars = [pick(upper), pick(lower), pick(digits)]
  while (chars.length < 14) chars.push(pick(all))
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
