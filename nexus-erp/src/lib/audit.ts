import type { PrismaClient, Prisma, AuditAction } from '@prisma/client'

export type { AuditAction }

// Accepts either a full PrismaClient or a transaction client (same shape for auditLog)
type AuditDb = { auditLog: PrismaClient['auditLog'] }

export interface CreateAuditLogParams {
  db: AuditDb
  entityType: string
  entityId: string
  action: AuditAction
  actorId: string
  actorName: string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

export async function createAuditLog({
  db,
  entityType,
  entityId,
  action,
  actorId,
  actorName,
  before = null,
  after = null,
}: CreateAuditLogParams): Promise<void> {
  await db.auditLog.create({
    data: {
      entityType,
      entityId,
      action,
      actorId,
      actorName,
      before: before != null ? (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue) : undefined,
      after: after != null ? (JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue) : undefined,
    },
  })
}
