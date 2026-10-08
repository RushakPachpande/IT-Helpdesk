import { prisma } from '../db.js'

export async function audit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLog
    .create({ data: { actorId, action, entityType, entityId, details: details as object | undefined } })
    .catch((err) => console.error('audit log write failed', err))
}
