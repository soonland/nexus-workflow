import { describe, expect, it } from 'vitest'
import { makeMembership, managerSession, operatorSession, systemAdminSession } from '../test/fakeApi'
import { canManageUsers, isOperator, isSystemAdmin, type Session } from './roles'

const user = (info: ReturnType<typeof operatorSession>): Session => ({ kind: 'user', ...info })
const systemAdmin = user(systemAdminSession())
const operator = user(operatorSession())
const manager = user(managerSession('acme'))
const nobody: Session = { kind: 'user', ...operatorSession(), memberships: [] }
const adminKey: Session = { kind: 'adminKey' }

describe('isSystemAdmin', () => {
  it.each([
    ['a system admin', systemAdmin, true],
    ['the admin key (it acts as a system admin)', adminKey, true],
    ['an operator', operator, false],
    ['a tenant manager', manager, false],
    ['someone without roles', nobody, false],
  ])('%s -> %s', (_label, session, expected) => {
    expect(isSystemAdmin(session)).toBe(expected)
  })
})

describe('isOperator', () => {
  it.each([
    ['a system admin (can do everything an operator can)', systemAdmin, true],
    ['an operator', operator, true],
    ['the admin key', adminKey, true],
    ['a tenant manager', manager, false],
    ['someone without roles', nobody, false],
  ])('%s -> %s', (_label, session, expected) => {
    expect(isOperator(session)).toBe(expected)
  })

  it('a system admin who also holds a manager role is still a system admin', () => {
    const both: Session = { kind: 'user', ...systemAdminSession(), memberships: [makeMembership({ role: 'system_admin' }), makeMembership({ id: 'm2', role: 'tenant_manager', tenantId: 'acme' })] }
    expect(isSystemAdmin(both)).toBe(true)
    expect(canManageUsers(both)).toBe(true)
  })
})
