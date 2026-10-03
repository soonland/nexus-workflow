import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from '../db/migrate.js'
import { InviteStore } from '../db/InviteStore.js'
import { TenantStore } from '../db/TenantStore.js'
import { UserStore } from '../db/UserStore.js'
import type { Principal } from './principal.js'
import { UserAdmin, type Outcome } from './UserAdmin.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

function expectOk<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`expected success, got ${outcome.error}: ${outcome.message}`)
  return outcome.value
}

describe('UserAdmin: who may do what to whom (Postgres)', () => {
  const prefix = `ua_${crypto.randomUUID().slice(0, 6)}`
  const tenantA = `${prefix}_a`
  const tenantB = `${prefix}_b`
  const email = (name: string) => `${prefix}.${name}@example.com`
  let sql: postgres.Sql
  let users: UserStore
  let admin: UserAdmin
  let operator: Principal
  let managerA: Principal
  let operatorAndManagerA: Principal
  const adminKey: Principal = { kind: 'adminKey' }
  const apiKey: Principal = { kind: 'apiKey', tenantId: tenantA }

  async function principalFor(name: string, roles: Array<['operator', null] | ['tenant_manager', string]>): Promise<Principal> {
    const user = await users.createUser({ email: email(name), name })
    for (const [role, tenantId] of roles) await users.addMembership(user.id, role, tenantId)
    return { kind: 'user', user, memberships: await users.listMemberships(user.id) }
  }

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    users = new UserStore(sql)
    admin = new UserAdmin(users, new InviteStore(sql, { hmacSecret: 'user-admin-secret', ttlMs: 24 * 3_600_000 }))
    const tenants = new TenantStore(sql, 'user-admin-secret')
    await tenants.createTenant(tenantA, 'A')
    await tenants.createTenant(tenantB, 'B')
    operator = await principalFor('operator', [['operator', null]])
    managerA = await principalFor('managerA', [['tenant_manager', tenantA]])
    await principalFor('managerB', [['tenant_manager', tenantB]])
    operatorAndManagerA = await principalFor('opAndA', [['operator', null], ['tenant_manager', tenantA]])
  })

  afterAll(async () => {
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql`DELETE FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    await sql.end()
  })

  // ─── creating people ───────────────────────────────────────────────────────

  describe('create', () => {
    it('an operator invites anyone with any roles, and gets a one-time invite back', async () => {
      const { user, invite } = expectOk(
        await admin.create(operator, {
          email: email('new-op'),
          name: 'New Op',
          memberships: [{ role: 'operator', tenantId: null }, { role: 'tenant_manager', tenantId: tenantA }],
        }),
      )

      expect(user.memberships.map((m) => m.role).sort()).toEqual(['operator', 'tenant_manager'])
      expect(user.hasPassword).toBe(false)
      expect(invite.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('the admin key counts as an operator', async () => {
      expect((await admin.create(adminKey, { email: email('byadminkey'), name: 'By Key' })).ok).toBe(true)
    })

    it('an operator may create someone with no roles yet', async () => {
      const { user } = expectOk(await admin.create(operator, { email: email('norole'), name: 'No Role' }))
      expect(user.memberships).toEqual([])
    })

    it('a tenant manager can invite a manager for their own tenant', async () => {
      const { user } = expectOk(
        await admin.create(managerA, { email: email('colleague'), name: 'Colleague', memberships: [{ role: 'tenant_manager', tenantId: tenantA }] }),
      )
      expect(user.memberships).toMatchObject([{ role: 'tenant_manager', tenantId: tenantA }])
    })

    it.each([
      ['an operator', [{ role: 'operator', tenantId: null }]],
      ['a manager of another tenant', [{ role: 'tenant_manager', tenantId: 'TENANT_B' }]],
      ['a manager of their tenant plus another', [{ role: 'tenant_manager', tenantId: 'TENANT_A' }, { role: 'tenant_manager', tenantId: 'TENANT_B' }]],
    ] as const)('a tenant manager cannot create %s', async (_label, memberships) => {
      const real = memberships.map((m) => ({ ...m, tenantId: m.tenantId === 'TENANT_A' ? tenantA : m.tenantId === 'TENANT_B' ? tenantB : m.tenantId }))
      const outcome = await admin.create(managerA, { email: email(`blocked-${_label.length}`), name: 'Blocked', memberships: real })

      expect(outcome).toMatchObject({ ok: false, error: 'FORBIDDEN' })
      expect(await users.findByEmail(email(`blocked-${_label.length}`))).toBeNull() // nothing was created
    })

    it('a tenant manager must give at least one membership (no orphan accounts they could not manage)', async () => {
      expect(await admin.create(managerA, { email: email('orphan'), name: 'Orphan' })).toMatchObject({ ok: false, error: 'FORBIDDEN' })
    })

    it('refuses a tenant that does not exist without leaving a half-created user behind', async () => {
      const outcome = await admin.create(operator, {
        email: email('badtenant'),
        name: 'Bad Tenant',
        memberships: [{ role: 'tenant_manager', tenantId: `${prefix}_missing` }],
      })

      expect(outcome).toMatchObject({ ok: false, error: 'INVALID' })
      expect(await users.findByEmail(email('badtenant'))).toBeNull()
    })

    it('refuses an invalid email or a duplicate', async () => {
      expect(await admin.create(operator, { email: 'nope', name: 'X' })).toMatchObject({ ok: false, error: 'INVALID' })
      expect(await admin.create(operator, { email: email('operator'), name: 'Again' })).toMatchObject({ ok: false, error: 'CONFLICT' })
    })

    it.each([['an API key', apiKey]])('refuses %s outright', async (_label, actor) => {
      expect(await admin.create(actor, { email: email('byapikey'), name: 'X' })).toMatchObject({ ok: false, error: 'FORBIDDEN' })
    })

    it('refuses a signed-in user who is neither an operator nor a manager', async () => {
      const nobody = await principalFor('nobody', [])
      expect(await admin.create(nobody, { email: email('bynobody'), name: 'X' })).toMatchObject({ ok: false, error: 'FORBIDDEN' })
    })
  })

  // ─── seeing people ─────────────────────────────────────────────────────────

  describe('list and get', () => {
    let onlyA: string
    let onlyB: string
    let aAndB: string

    beforeAll(async () => {
      onlyA = expectOk(await admin.create(operator, { email: email('list-a'), name: 'A', memberships: [{ role: 'tenant_manager', tenantId: tenantA }] })).user.id
      onlyB = expectOk(await admin.create(operator, { email: email('list-b'), name: 'B', memberships: [{ role: 'tenant_manager', tenantId: tenantB }] })).user.id
      aAndB = expectOk(
        await admin.create(operator, {
          email: email('list-ab'), name: 'AB',
          memberships: [{ role: 'tenant_manager', tenantId: tenantA }, { role: 'tenant_manager', tenantId: tenantB }],
        }),
      ).user.id
    })

    const idsOf = async (actor: Principal) => expectOk(await admin.list(actor)).map((u) => u.id)

    it('an operator sees everyone', async () => {
      const ids = await idsOf(operator)
      expect(ids).toEqual(expect.arrayContaining([onlyA, onlyB, aAndB]))
    })

    it('a manager sees only the people who belong wholly to their tenants', async () => {
      const ids = await idsOf(managerA)
      expect(ids).toContain(onlyA)
      expect(ids).not.toContain(onlyB)
      expect(ids).not.toContain(aAndB) // also in B
      expect(ids).not.toContain((operator as { user: { id: string } }).user.id)
    })

    it('a manager of both tenants sees the person who belongs to both', async () => {
      const both = await principalFor('managerBoth', [['tenant_manager', tenantA], ['tenant_manager', tenantB]])
      expect(await idsOf(both)).toContain(aAndB)
    })

    it('get: a manager asking about someone outside their tenants is told there is no such user', async () => {
      expect(await admin.get(managerA, onlyB)).toMatchObject({ ok: false, error: 'NOT_FOUND' })
      expect(await admin.get(managerA, aAndB)).toMatchObject({ ok: false, error: 'NOT_FOUND' })
      expect((await admin.get(managerA, onlyA)).ok).toBe(true)
      expect((await admin.get(operator, onlyB)).ok).toBe(true)
      expect(await admin.get(operator, '0'.repeat(32))).toMatchObject({ ok: false, error: 'NOT_FOUND' })
    })

    it('an API key cannot see anyone', async () => {
      expect(await admin.list(apiKey)).toMatchObject({ ok: false, error: 'FORBIDDEN' })
    })
  })

  // ─── changing people ───────────────────────────────────────────────────────

  describe('setStatus', () => {
    async function inTenantA(name: string) {
      return expectOk(await admin.create(operator, { email: email(name), name, memberships: [{ role: 'tenant_manager', tenantId: tenantA }] })).user
    }

    it('a manager can disable and re-enable someone in their tenant; sessions end on disable', async () => {
      const person = await inTenantA('toggle')
      await sql`INSERT INTO public.sessions (token_hash, user_id, expires_at) VALUES (${'s-' + person.id}, ${person.id}, now() + interval '1 hour')`

      expectOk(await admin.setStatus(managerA, person.id, 'disabled'))
      expect((await users.findById(person.id))?.status).toBe('disabled')
      expect(await sql`SELECT 1 FROM public.sessions WHERE user_id = ${person.id}`).toHaveLength(0)

      expectOk(await admin.setStatus(managerA, person.id, 'active'))
      expect((await users.findById(person.id))?.status).toBe('active')
    })

    it('a manager cannot touch someone in another tenant, or someone who also belongs elsewhere', async () => {
      const other = expectOk(await admin.create(operator, { email: email('inb'), name: 'B', memberships: [{ role: 'tenant_manager', tenantId: tenantB }] })).user
      const shared = expectOk(
        await admin.create(operator, {
          email: email('shared'), name: 'Shared',
          memberships: [{ role: 'tenant_manager', tenantId: tenantA }, { role: 'tenant_manager', tenantId: tenantB }],
        }),
      ).user

      expect(await admin.setStatus(managerA, other.id, 'disabled')).toMatchObject({ ok: false, error: 'NOT_FOUND' })
      expect(await admin.setStatus(managerA, shared.id, 'disabled')).toMatchObject({ ok: false, error: 'NOT_FOUND' })
      expect((await users.findById(other.id))?.status).toBe('active')
      expect((await users.findById(shared.id))?.status).toBe('active')
    })

    it('a manager cannot touch an operator, even one who also manages their tenant', async () => {
      const opId = (operatorAndManagerA as { user: { id: string } }).user.id
      expect(await admin.setStatus(managerA, opId, 'disabled')).toMatchObject({ ok: false, error: 'NOT_FOUND' })
    })

    it('nobody can disable themselves', async () => {
      const selfId = (managerA as { user: { id: string } }).user.id
      expect(await admin.setStatus(managerA, selfId, 'disabled')).toMatchObject({ ok: false, error: 'CONFLICT' })
      expect(await admin.setStatus(operator, (operator as { user: { id: string } }).user.id, 'disabled')).toMatchObject({ ok: false, error: 'CONFLICT' })
    })

    it('an operator can disable anyone else', async () => {
      const person = await inTenantA('byoperator')
      expect((await admin.setStatus(operator, person.id, 'disabled')).ok).toBe(true)
    })

    it('reports an unknown user as not found', async () => {
      expect(await admin.setStatus(operator, '0'.repeat(32), 'disabled')).toMatchObject({ ok: false, error: 'NOT_FOUND' })
    })
  })

  describe('memberships', () => {
    it('an operator grants and removes any role', async () => {
      const person = expectOk(await admin.create(operator, { email: email('grant'), name: 'Grant' })).user

      const op = expectOk(await admin.addMembership(operator, person.id, { role: 'operator', tenantId: null }))
      const mgr = expectOk(await admin.addMembership(operator, person.id, { role: 'tenant_manager', tenantId: tenantB }))

      expect((await users.listMemberships(person.id)).map((m) => m.role).sort()).toEqual(['operator', 'tenant_manager'])
      expect((await admin.removeMembership(operator, person.id, op.id)).ok).toBe(true)
      expect((await admin.removeMembership(operator, person.id, mgr.id)).ok).toBe(true)
    })

    it('a manager can add someone in their tenant to another of their own tenants, but never grant operator', async () => {
      const both = await principalFor('mgrBoth2', [['tenant_manager', tenantA], ['tenant_manager', tenantB]])
      const person = expectOk(await admin.create(both, { email: email('addmore'), name: 'Add', memberships: [{ role: 'tenant_manager', tenantId: tenantA }] })).user

      expect((await admin.addMembership(both, person.id, { role: 'tenant_manager', tenantId: tenantB })).ok).toBe(true)
      expect(await admin.addMembership(both, person.id, { role: 'operator', tenantId: null })).toMatchObject({ ok: false, error: 'FORBIDDEN' })
    })

    it('a manager cannot grant a tenant they do not manage', async () => {
      const person = expectOk(await admin.create(managerA, { email: email('overreach'), name: 'Over', memberships: [{ role: 'tenant_manager', tenantId: tenantA }] })).user

      expect(await admin.addMembership(managerA, person.id, { role: 'tenant_manager', tenantId: tenantB })).toMatchObject({ ok: false, error: 'FORBIDDEN' })
    })

    it('a manager cannot add roles to someone outside their tenants', async () => {
      const outsider = expectOk(await admin.create(operator, { email: email('outsider'), name: 'Out', memberships: [{ role: 'tenant_manager', tenantId: tenantB }] })).user

      expect(await admin.addMembership(managerA, outsider.id, { role: 'tenant_manager', tenantId: tenantA })).toMatchObject({ ok: false, error: 'NOT_FOUND' })
    })

    it('a manager can remove a role of someone in their tenant, and cannot reach anyone else', async () => {
      const colleague = expectOk(
        await admin.create(operator, {
          email: email('rmcolleague'), name: 'Rm',
          memberships: [{ role: 'tenant_manager', tenantId: tenantA }],
        }),
      ).user
      const m = (await users.listMemberships(colleague.id))[0]!
      const outsider = expectOk(await admin.create(operator, { email: email('rmoutsider'), name: 'Rm2', memberships: [{ role: 'tenant_manager', tenantId: tenantB }] })).user
      const outsiderMembership = (await users.listMemberships(outsider.id))[0]!

      expect(await admin.removeMembership(managerA, outsider.id, outsiderMembership.id)).toMatchObject({ ok: false, error: 'NOT_FOUND' })
      expect((await admin.removeMembership(managerA, colleague.id, m.id)).ok).toBe(true)
    })

    it('nobody can strip their own last role, or their own operator role', async () => {
      const selfOp = await principalFor('selfop', [['operator', null], ['tenant_manager', tenantA]])
      const selfMgr = await principalFor('selfmgr', [['tenant_manager', tenantA]])
      if (selfOp.kind !== 'user' || selfMgr.kind !== 'user') throw new Error('expected users')
      const opMembership = selfOp.memberships.find((m) => m.role === 'operator')!
      const onlyMembership = selfMgr.memberships[0]!

      expect(await admin.removeMembership(selfOp, selfOp.user.id, opMembership.id)).toMatchObject({ ok: false, error: 'CONFLICT' })
      expect(await admin.removeMembership(selfMgr, selfMgr.user.id, onlyMembership.id)).toMatchObject({ ok: false, error: 'CONFLICT' })
      // but another operator can
      expect((await admin.removeMembership(operator, selfMgr.user.id, onlyMembership.id)).ok).toBe(true)
    })

    it('reports an unknown membership as not found', async () => {
      const person = expectOk(await admin.create(operator, { email: email('nomem'), name: 'No' })).user
      expect(await admin.removeMembership(operator, person.id, 'nope')).toMatchObject({ ok: false, error: 'NOT_FOUND' })
    })

    it('rejects a combination the model does not allow', async () => {
      const person = expectOk(await admin.create(operator, { email: email('badcombo'), name: 'Bad' })).user
      expect(await admin.addMembership(operator, person.id, { role: 'operator', tenantId: tenantA })).toMatchObject({ ok: false, error: 'INVALID' })
      expect(await admin.addMembership(operator, person.id, { role: 'tenant_manager', tenantId: null })).toMatchObject({ ok: false, error: 'INVALID' })
      expect(await admin.addMembership(operator, person.id, { role: 'tenant_manager', tenantId: `${prefix}_missing` })).toMatchObject({ ok: false, error: 'INVALID' })
    })
  })

  describe('reinvite', () => {
    it('issues a fresh invite and retires the previous one', async () => {
      const created = expectOk(await admin.create(managerA, { email: email('reinv'), name: 'Re', memberships: [{ role: 'tenant_manager', tenantId: tenantA }] }))

      const again = expectOk(await admin.reinvite(managerA, created.user.id))

      expect(again.invite.token).not.toBe(created.invite.token)
      expect(await sql`SELECT 1 FROM public.invites WHERE user_id = ${created.user.id} AND used_at IS NULL`).toHaveLength(1)
    })

    it('a manager cannot re-invite someone outside their tenants (that would be a way to take over their account)', async () => {
      const outsider = expectOk(await admin.create(operator, { email: email('reinv-out'), name: 'Out', memberships: [{ role: 'tenant_manager', tenantId: tenantB }] })).user
      expect(await admin.reinvite(managerA, outsider.id)).toMatchObject({ ok: false, error: 'NOT_FOUND' })
      const opId = (operator as { user: { id: string } }).user.id
      expect(await admin.reinvite(managerA, opId)).toMatchObject({ ok: false, error: 'NOT_FOUND' })
    })

    it('refuses to invite a disabled user until they are enabled again', async () => {
      const person = expectOk(await admin.create(operator, { email: email('reinv-dis'), name: 'Dis', memberships: [{ role: 'tenant_manager', tenantId: tenantA }] })).user
      await admin.setStatus(operator, person.id, 'disabled')

      expect(await admin.reinvite(operator, person.id)).toMatchObject({ ok: false, error: 'CONFLICT' })
    })

    it('an operator can re-invite anyone, which is how a forgotten password is reset', async () => {
      expect((await admin.reinvite(operator, (managerA as { user: { id: string } }).user.id)).ok).toBe(true)
    })
  })
})
