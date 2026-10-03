import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { TenantStore } from './TenantStore.js'
import { UserStore } from './UserStore.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('UserStore listing with memberships (Postgres)', () => {
  const prefix = `ul_${crypto.randomUUID().slice(0, 6)}`
  const tenantA = `${prefix}_a`
  const tenantB = `${prefix}_b`
  let sql: postgres.Sql
  let users: UserStore
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    users = new UserStore(sql)
    const tenants = new TenantStore(sql, 'listing-secret')
    await tenants.createTenant(tenantA, 'A')
    await tenants.createTenant(tenantB, 'B')

    const make = async (name: string, roles: Array<['operator', null] | ['tenant_manager', string]>) => {
      const user = await users.createUser({ email: `${prefix}.${name}@example.com`, name })
      for (const [role, tenantId] of roles) await users.addMembership(user.id, role, tenantId)
      ids[name] = user.id
    }
    await make('onlyA', [['tenant_manager', tenantA]])
    await make('onlyA2', [['tenant_manager', tenantA]])
    await make('onlyB', [['tenant_manager', tenantB]])
    await make('aAndB', [['tenant_manager', tenantA], ['tenant_manager', tenantB]])
    await make('operatorAndA', [['operator', null], ['tenant_manager', tenantA]])
    await make('nobody', [])
  })

  afterAll(async () => {
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql`DELETE FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    await sql.end()
  })

  const mine = <T extends { email: string }>(rows: T[]) => rows.filter((r) => r.email.startsWith(prefix + '.'))

  it('lists every user with their memberships', async () => {
    const rows = mine(await users.listWithMemberships())

    expect(rows).toHaveLength(6)
    const aAndB = rows.find((r) => r.id === ids['aAndB'])
    expect(aAndB?.memberships.map((m) => m.tenantId).sort()).toEqual([tenantA, tenantB].sort())
    expect(rows.find((r) => r.id === ids['nobody'])?.memberships).toEqual([])
    for (const row of rows) expect(row).not.toHaveProperty('passwordHash')
  })

  it('scoped to tenants: only users whose every membership is a manager role in those tenants', async () => {
    const rows = mine(await users.listWithMemberships({ withinTenants: [tenantA] }))

    // onlyA and onlyA2 qualify; aAndB also belongs to B, operatorAndA is an operator, nobody has no tenant
    expect(rows.map((r) => r.id).sort()).toEqual([ids['onlyA']!, ids['onlyA2']!].sort())
  })

  it('scoped to several tenants includes people spanning exactly those tenants', async () => {
    const rows = mine(await users.listWithMemberships({ withinTenants: [tenantA, tenantB] }))
    expect(rows.map((r) => r.id).sort()).toEqual([ids['onlyA']!, ids['onlyA2']!, ids['onlyB']!, ids['aAndB']!].sort())
  })

  it('scoped to no tenants returns nobody', async () => {
    expect(mine(await users.listWithMemberships({ withinTenants: [] }))).toEqual([])
  })

  it('getWithMemberships returns one user with their memberships, or null', async () => {
    const user = await users.getWithMemberships(ids['operatorAndA']!)
    expect(user?.memberships.map((m) => m.role).sort()).toEqual(['operator', 'tenant_manager'])
    expect(await users.getWithMemberships('0'.repeat(32))).toBeNull()
  })

  it('isWithinTenants says whether a user is wholly inside the given tenants', async () => {
    expect(await users.isWithinTenants(ids['onlyA']!, [tenantA])).toBe(true)
    expect(await users.isWithinTenants(ids['aAndB']!, [tenantA])).toBe(false)
    expect(await users.isWithinTenants(ids['aAndB']!, [tenantA, tenantB])).toBe(true)
    expect(await users.isWithinTenants(ids['operatorAndA']!, [tenantA])).toBe(false)
    expect(await users.isWithinTenants(ids['nobody']!, [tenantA])).toBe(false) // no membership: not theirs to manage
  })
})
