import type { Membership, User } from '../api/types'

/** Who is using the console: a person with a session, or someone holding the admin key. */
export type Session = { kind: 'user'; user: User; memberships: Membership[] } | { kind: 'adminKey' }

/** Operators (and the admin key) run the platform: tenants and every person. */
export function isOperator(session: Session): boolean {
  return session.kind === 'adminKey' || session.memberships.some((m) => m.role === 'operator')
}

/** The tenants this person manages (empty for the admin key, which is not tied to any). */
export function managedTenantIds(session: Session): string[] {
  if (session.kind === 'adminKey') return []
  return [...new Set(session.memberships.flatMap((m) => (m.role === 'tenant_manager' && m.tenantId ? [m.tenantId] : [])))]
}

export function canManageUsers(session: Session): boolean {
  return isOperator(session) || managedTenantIds(session).length > 0
}

export function describeSession(session: Session): string {
  if (session.kind === 'adminKey') return 'Admin key'
  return session.user.name || session.user.email
}
