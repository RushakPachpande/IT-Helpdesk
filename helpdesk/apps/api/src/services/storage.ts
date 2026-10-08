import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import { config } from '../config.js'
import { sha256 } from '../crypto.js'
import { badRequest } from '../http.js'

export interface StoredFile {
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  storagePath: string
  inline: boolean
}

/** Types that are safe to show inline in the browser. */
export const INLINE_SAFE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])

const TEXT_LIKE = new Set(['text/plain', 'text/csv'])

export function sanitizeFileName(name: string): string {
  const base = path.basename(name || 'file').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').trim()
  return (base || 'file').slice(0, 150)
}

/**
 * Detect the real type from file contents. Falls back to the declared type only for
 * plain-text formats that have no magic bytes.
 */
export async function detectMime(content: Buffer, declared: string): Promise<string> {
  const sniffed = await fileTypeFromBuffer(content)
  if (sniffed) return sniffed.mime
  return TEXT_LIKE.has(declared) ? declared : 'application/octet-stream'
}

export async function storeFile(content: Buffer, fileName: string, mimeType: string, inline = false): Promise<StoredFile> {
  const now = new Date()
  const rel = path.join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), randomUUID())
  const abs = path.join(config.uploadDir, rel)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content)
  return {
    fileName: sanitizeFileName(fileName),
    mimeType,
    sizeBytes: content.length,
    sha256: sha256(content),
    storagePath: rel.replace(/\\/g, '/'),
    inline,
  }
}

/** Validate and store a user upload against the admin's attachment settings. */
export async function storeUpload(
  content: Buffer,
  fileName: string,
  declaredMime: string,
  allowedMimeTypes: string[],
): Promise<StoredFile> {
  if (content.length === 0) throw badRequest(`${fileName} is empty`)
  const mime = await detectMime(content, declaredMime)
  if (!allowedMimeTypes.includes(mime)) {
    throw badRequest(`${sanitizeFileName(fileName)}: file type ${mime} is not allowed`)
  }
  return storeFile(content, fileName, mime)
}

export function resolveStoragePath(storagePath: string): string {
  const abs = path.resolve(config.uploadDir, storagePath)
  if (!abs.startsWith(path.resolve(config.uploadDir))) throw badRequest('Invalid path')
  return abs
}

export function openStoredFile(storagePath: string) {
  return createReadStream(resolveStoragePath(storagePath))
}

export function readStoredFile(storagePath: string): Promise<Buffer> {
  return fs.readFile(resolveStoragePath(storagePath))
}
