import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { LastOperatorError, UserStore } from './UserStore.js'

// "The last operator" is counted across the whole database, so these tests run in a scratch
// database of their own where they control exactly who the operators are.

const BASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const DB_NAME = `nexus_ops_${Date.now()}`
const SCRATCH_URL = (() => {
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`
  return url.toString()
})()

describe('UserStore: the platform always keeps an active operator', () => {
  let admin: postgres.Sql
  let sql: postgres.Sql
  let users: UserStore
  let n = 0

  beforeAll(async () => {
    admin = postgres(BASE_URL)
    await admin.unsafe(`CREATE DATABASE "${DB_NAME}"`)
    await runMigrations(SCRATCH_URL)
    sql = postgres(SCRATCH_URL)
    users = new UserStore(sql)
  })

  afterAll(async () => {
    await sql.end()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
    await admin.end()
  })

  async function operator() {
    const user = await users.createUser({ email: `op${++n}@example.com`, name: `Op ${n}` })
    const membership = await users.addMembership(user.id, 'operator', null)
    return { user, membership }
  }

  async function reset() {
    await sql`DELETE FROM public.users`
  }

  it('refuses to disable the only operator', async () => {
    await reset()
    const only = await operator()

    await expect(users.setStatus(only.user.id, 'disabled')).rejects.toBeInstanceOf(LastOperatorError)

    expect((await users.findById(only.user.id))?.status).toBe('active')
  })

  it('refuses to remove the only operator membership', async () => {
    await reset()
    const only = await operator()

    await expect(users.removeMembership(only.user.id, only.membership.id)).rejects.toBeInstanceOf(LastOperatorError)

    expect(await users.listMemberships(only.user.id)).toHaveLength(1)
  })

  it('allows both once there is another active operator, and then protects the one that is left', async () => {
    await reset()
    const a = await operator()
    const b = await operator()

    expect(await users.setStatus(a.user.id, 'disabled')).toBe(true)
    await expect(users.setStatus(b.user.id, 'disabled')).rejects.toBeInstanceOf(LastOperatorError)
    await expect(users.removeMembership(b.user.id, b.membership.id)).rejects.toBeInstanceOf(LastOperatorError)
  })

  it('does not count a disabled operator as the one that is "left"', async () => {
    await reset()
    const a = await operator()
    const b = await operator()
    await users.setStatus(b.user.id, 'disabled')

    await expect(users.setStatus(a.user.id, 'disabled')).rejects.toBeInstanceOf(LastOperatorError)

    // bringing the other one back makes room again
    await users.setStatus(b.user.id, 'active')
    expect(await users.setStatus(a.user.id, 'disabled')).toBe(true)
  })

  it('removing the operator role from a disabled operator is fine: they were not one of the active ones', async () => {
    await reset()
    const a = await operator()
    const b = await operator()
    await users.setStatus(b.user.id, 'disabled')

    expect(await users.removeMembership(b.user.id, b.membership.id)).toBe(true)
    expect(await users.setStatus(a.user.id, 'active')).toBe(true)
  })

  it('never gets in the way of everything else', async () => {
    await reset()
    const only = await operator()
    const manager = await users.createUser({ email: 'manager@example.com', name: 'Manager' })
    const tenantId = 'ops-test-tenant'
    await sql`INSERT INTO public.tenants (id, name) VALUES (${tenantId}, 'T')`
    const membership = await users.addMembership(manager.id, 'tenant_manager', tenantId)

    expect(await users.setStatus(manager.id, 'disabled')).toBe(true)
    expect(await users.setStatus(manager.id, 'active')).toBe(true)
    expect(await users.removeMembership(manager.id, membership.id)).toBe(true)
    expect(await users.setStatus(only.user.id, 'active')).toBe(true) // re-enabling is always allowed
  })

  it('lets only one of two simultaneous removals of the last two operators through', async () => {
    await reset()
    const a = await operator()
    const b = await operator()

    const results = await Promise.allSettled([users.setStatus(a.user.id, 'disabled'), users.setStatus(b.user.id, 'disabled')])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const active = await sql`SELECT 1 FROM public.users WHERE status = 'active'`
    expect(active).toHaveLength(1)
  })
})
