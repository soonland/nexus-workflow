import type { Membership, User } from '../db/UserStore.js'

/**
 * Who is making a request, once the credential has been checked.
 *  - `user`: a person with a session; what they may do comes from their memberships.
 *  - `apiKey`: a tenant API key (what programs use); bound to one tenant.
 *  - `adminKey`: the platform's ADMIN_API_KEY, a break-glass operator credential.
 */
export type Principal =
  | { kind: 'user'; user: User; memberships: Membership[] }
  | { kind: 'apiKey'; tenantId: string }
  | { kind: 'adminKey' }

/** May administer the platform (tenants, users). Does not by itself open any tenant's data. */
export function isOperator(principal: Principal): boolean {
  if (principal.kind === 'adminKey') return true
  if (principal.kind === 'user') return principal.memberships.some((m) => m.role === 'operator')
  return false
}

/** The tenants a signed-in user is a manager of. */
export function managedTenantIds(principal: Principal): string[] {
  if (principal.kind !== 'user') return []
  return principal.memberships.flatMap((m) => (m.role === 'tenant_manager' && m.tenantId !== null ? [m.tenantId] : []))
}

/**
 * May use the tenant's own data (definitions, instances, tasks, ...). A tenant API key belongs to
 * one tenant; a user needs a tenant_manager membership for it. The operator role does not
 * grant this: operating the platform is not the same as reading a customer's workflows, and an
 * operator who needs to look inside a tenant has to hold a membership or a key for it.
 */
export function canUseTenant(principal: Principal, tenantId: string): boolean {
  if (principal.kind === 'apiKey') return principal.tenantId === tenantId
  return managedTenantIds(principal).includes(tenantId)
}
