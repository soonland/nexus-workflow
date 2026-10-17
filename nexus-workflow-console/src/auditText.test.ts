import { describe, it, expect } from 'vitest'
import { auditFacts, describeAudit } from './auditText'
import { makeAuditEntry } from './test/fakeApi'

const entry = (action: string, details: Record<string, unknown> = {}, target: string | null = 'acme') => makeAuditEntry({ action, details, target })

describe('describeAudit', () => {
  it.each([
    [entry('tenant.create'), 'Created tenant acme'],
    [entry('tenant.suspend'), 'Suspended tenant acme'],
    [entry('tenant.reactivate'), 'Reactivated tenant acme'],
    [entry('tenant.rename', { name: 'Acme Corp' }), 'Renamed tenant acme to "Acme Corp"'],
    [entry('tenant.delete'), 'Deleted tenant acme'],
    [entry('key.create', { name: 'ci' }, 'key-1'), 'Created API key "ci"'],
    [entry('key.create', { name: 'erp', role: 'tenant_manager' }, 'key-1'), 'Created API key "erp" (tenant_manager)'],
    [entry('key.role', { name: 'erp', from: 'service', to: 'tenant_manager' }, 'key-1'), 'Changed the role of API key "erp" from service to tenant_manager'],
    [entry('key.revoke', {}, 'key-1'), 'Revoked an API key'],
    [entry('user.create', { email: 'ada@example.com' }, 'u1'), 'Invited ada@example.com'],
    [entry('user.disable', { email: 'ada@example.com' }, 'u1'), 'Disabled ada@example.com'],
    [entry('user.enable', { email: 'ada@example.com' }, 'u1'), 'Enabled ada@example.com'],
    [entry('membership.add', { email: 'ada@example.com', role: 'tenant_manager', tenantId: 'acme' }, 'u1'), 'Gave ada@example.com the role manager of acme'],
    [entry('membership.add', { email: 'ada@example.com', role: 'operator', tenantId: null }, 'u1'), 'Gave ada@example.com the role operator'],
    [entry('membership.add', { email: 'ada@example.com', role: 'system_admin', tenantId: null }, 'u1'), 'Gave ada@example.com the role system admin'],
    [entry('membership.remove', { email: 'ada@example.com', role: 'operator' }, 'u1'), 'Removed the role operator from ada@example.com'],
    [entry('invite.create', { email: 'ada@example.com', reset: false }, 'u1'), 'Issued a new invitation for ada@example.com'],
    [entry('invite.create', { email: 'ada@example.com', reset: true }, 'u1'), 'Issued a new invitation (password reset) for ada@example.com'],
    [entry('invite.accept', {}, 'u1'), 'Accepted their invitation'],
    [entry('step.force', { elementId: 'send', reason: 'mail server down', step: 'completeServiceTask' }, 'inst-1'), 'Pushed step send along by hand: “mail server down”'],
    [entry('step.force', { elementId: 'review', reason: 'on leave', onBehalfOf: 'ada@example.com' }, 'inst-1'), 'Pushed step review along by hand for ada@example.com: “on leave”'],
    [entry('login.success'), 'Signed in'],
    [entry('login.failure', { reason: 'bad credentials' }), 'Failed sign-in (bad credentials)'],
  ])('puts %# in words', (item, sentence) => {
    expect(describeAudit(item)).toBe(sentence)
  })

  it('falls back to the code for an action it does not know, so nothing is hidden', () => {
    expect(describeAudit(entry('something.new'))).toBe('something.new')
  })

  it('copes with details that are missing', () => {
    expect(describeAudit(entry('user.create', {}, 'u1'))).toBe('Invited u1')
    expect(describeAudit(entry('key.create', {}, 'k'))).toBe('Created API key')
    expect(describeAudit(entry('tenant.rename', {}, null))).toBe('Renamed tenant')
    expect(describeAudit(entry('login.failure'))).toBe('Failed sign-in')
  })
})

describe('auditFacts', () => {
  it('lists the facts the sentence does not already say', () => {
    expect(auditFacts(entry('login.success', { ip: '10.0.0.1' }))).toBe('ip: 10.0.0.1')
    expect(auditFacts(entry('user.create', { email: 'a@b.c', roles: [{ role: 'operator', tenantId: null }], invited: true }))).toBe(
      'roles: [{"role":"operator","tenantId":null}] · invited: true',
    )
  })

  it('is empty when there is nothing more to say', () => {
    expect(auditFacts(entry('tenant.suspend'))).toBe('')
    expect(auditFacts(entry('login.failure', { reason: 'x' }))).toBe('')
  })
})
