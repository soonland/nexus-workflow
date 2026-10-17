import type { Membership, User } from '../db/UserStore.js'

/**
 * Who is making a request, once the credential has been checked.
 *  - `user`: a person with a session; what they may do comes from their memberships.
 *  - `apiKey`: a tenant API key (what programs use); bound to one tenant, with a role.
 *  - `adminKey`: the platform's ADMIN_API_KEY, a break-glass operator credential.
 *  - `operatorKey`: a named, revocable, database-backed operator credential (never valid for a tenant's own data).
 */
export type Principal =
  | { kind: 'user'; user: User; memberships: Membership[] }
  | { kind: 'apiKey'; tenantId: string; keyId: string; keyName: string; role: KeyRole }
  | { kind: 'adminKey' }
  | { kind: 'operatorKey'; keyId: string; keyName: string }

/**
 * What a tenant API key may do (see migration 013):
 *  - `service`: the runtime API: instances, tasks, events, messages, signals, and definitions (read, deploy).
 *  - `tenant_manager`: everything in its tenant, including webhooks, metrics and administrative commands.
 */
export type KeyRole = 'service' | 'tenant_manager'
export const KEY_ROLES: readonly KeyRole[] = ['service', 'tenant_manager']

/**
 * The top platform role: the only one that can create, disable or remove operators. Held by a user with
 * the `system_admin` membership (granted from the command line only) and by the admin key. Operator
 * keys are never system admins.
 */
export function isSystemAdmin(principal: Principal): boolean {
  if (principal.kind === 'adminKey') return true
  if (principal.kind === 'user') return principal.memberships.some((m) => m.role === 'system_admin')
  return false
}

/**
 * May administer the platform (tenants, users). A system admin can do everything an operator can.
 * Does not by itself open any tenant's data.
 */
export function isOperator(principal: Principal): boolean {
  if (principal.kind === 'adminKey' || principal.kind === 'operatorKey') return true
  if (principal.kind === 'user') return principal.memberships.some((m) => m.role === 'operator' || m.role === 'system_admin')
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
