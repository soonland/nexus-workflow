import { describe, it, expect } from 'vitest'
import type { Membership, User } from '../db/UserStore.js'
import { canUseTenant, isOperator, managedTenantIds, type Principal } from './principal.js'

const user: User = {
  id: 'u1', email: 'a@example.com', name: 'A', status: 'active',
  createdAt: new Date(), lastLoginAt: null, hasPassword: true,
}

const membership = (role: Membership['role'], tenantId: string | null): Membership => ({
  id: `m-${role}-${tenantId}`, userId: 'u1', role, tenantId, createdAt: new Date(),
})

const asUser = (...memberships: Membership[]): Principal => ({ kind: 'user', user, memberships })
const operator = asUser(membership('operator', null))
const managerOfA = asUser(membership('tenant_manager', 'a'))
const managerOfAandB = asUser(membership('tenant_manager', 'a'), membership('tenant_manager', 'b'))
const both = asUser(membership('operator', null), membership('tenant_manager', 'a'))
const noRoles = asUser()
const apiKeyOfA: Principal = { kind: 'apiKey', tenantId: 'a' }
const adminKey: Principal = { kind: 'adminKey' }

describe('isOperator', () => {
  it.each([
    ['an operator user', operator, true],
    ['a user who is both operator and manager', both, true],
    ['the admin key (break-glass)', adminKey, true],
    ['a tenant manager', managerOfA, false],
    ['a user without roles', noRoles, false],
    ['a tenant API key', apiKeyOfA, false],
  ])('%s -> %s', (_label, principal, expected) => {
    expect(isOperator(principal)).toBe(expected)
  })
})

describe('managedTenantIds', () => {
  it('lists the tenants a user manages, and nothing for anyone else', () => {
    expect(managedTenantIds(managerOfAandB).sort()).toEqual(['a', 'b'])
    expect(managedTenantIds(both)).toEqual(['a'])
    expect(managedTenantIds(operator)).toEqual([])
    expect(managedTenantIds(apiKeyOfA)).toEqual([])
    expect(managedTenantIds(adminKey)).toEqual([])
  })
})

describe('canUseTenant (access to a tenant\'s own data)', () => {
  it('lets a manager into the tenants they manage, and only those', () => {
    expect(canUseTenant(managerOfA, 'a')).toBe(true)
    expect(canUseTenant(managerOfA, 'b')).toBe(false)
    expect(canUseTenant(managerOfAandB, 'b')).toBe(true)
  })

  it('lets a tenant API key into its own tenant only', () => {
    expect(canUseTenant(apiKeyOfA, 'a')).toBe(true)
    expect(canUseTenant(apiKeyOfA, 'b')).toBe(false)
  })

  it('does NOT open any tenant to an operator: running the platform is not reading its customers\' data', () => {
    expect(canUseTenant(operator, 'a')).toBe(false)
    expect(canUseTenant(adminKey, 'a')).toBe(false)
  })

  it('an operator who is also a manager only gets the tenants they manage', () => {
    expect(canUseTenant(both, 'a')).toBe(true)
    expect(canUseTenant(both, 'b')).toBe(false)
  })

  it('refuses a user with no roles', () => {
    expect(canUseTenant(noRoles, 'a')).toBe(false)
  })
})
