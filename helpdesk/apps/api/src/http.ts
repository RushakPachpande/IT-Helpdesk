import type { FastifyReply, FastifyRequest } from 'fastify'
import { ZodError, type ZodType } from 'zod'

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

export const badRequest = (msg: string, code?: string) => new HttpError(400, msg, code)
export const forbidden = (msg = 'Forbidden', code?: string) => new HttpError(403, msg, code)
export const notFound = (msg = 'Not found') => new HttpError(404, msg)
export const conflict = (msg: string) => new HttpError(409, msg)

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  return schema.parse(data)
}

export function errorHandler(err: Error & { statusCode?: number; code?: string }, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join('; ')
    return reply.status(400).send({ error: message, code: 'VALIDATION' })
  }
  if (err instanceof HttpError) {
    return reply.status(err.statusCode).send({ error: err.message, code: err.code })
  }
  const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500
  if (status >= 500) req.log.error(err)
  return reply.status(status).send({ error: status >= 500 ? 'Internal server error' : err.message, code: err.code })
}
