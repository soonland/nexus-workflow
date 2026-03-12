import type { PrismaClient } from '@prisma/client'
import { getEffectivePermissions, type Resource, type CrudAction } from './permissions'

interface Session {
  user: { id: string; role: string; employeeId?: string | null }
}

/**
 * Returns true if the session user can perform `action` on `resource`.
 *
 * Access is granted when EITHER condition holds (additive, no deny):
 *   1. Ownership  — the record's ownerUserId matches the session user's id
 *   2. Permission — the user has `resource:action` in their effective permissions
 *      (direct grant, security group, default group, or department)
 *
 * Pass `ownerUserId = null` when there is no owner concept for the record
 * (access is then permission-only).
 */
export async function canAccess(
  session: Session,
  resource: Resource,
  action: CrudAction,
  ownerUserId: string | null,
  db: PrismaClient,
): Promise<boolean> {
  if (ownerUserId !== null && ownerUserId === session.user.id) return true
  const perms = await getEffectivePermissions(session.user.id, db)
  return perms.includes(`${resource}:${action}`)
}
