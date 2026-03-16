import type { PrismaClient } from '@prisma/client'
import { getEffectivePermissions } from './permissions'

interface Session {
  user: { id: string; role?: string }
}

/**
 * Returns true if the session user can view expenses across all employees.
 *
 * Granted to members of the Accounting department via the
 * `expenses:accounting-approve` department permission.
 * All other users see only their own (or their team's) expenses.
 */
export async function canViewAllExpenses(
  session: Session,
  db: PrismaClient,
): Promise<boolean> {
  const perms = await getEffectivePermissions(session.user.id, db)
  return perms.includes('expenses:accounting-approve')
}

/**
 * Returns true if the session user is a manager and can view their direct
 * reports' expenses.
 */
export function canViewTeamExpenses(session: Session): boolean {
  return session.user.role === 'manager'
}
