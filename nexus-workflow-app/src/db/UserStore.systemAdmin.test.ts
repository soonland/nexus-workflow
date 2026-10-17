import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { LastOperatorError, UserInputError, UserStore } from './UserStore.js'

// "The last administrator" is counted across the whole database, so these tests run in a scratch
// database of their own where they control exactly who holds a platform role.

const BASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const DB_NAME = `nexus_sa_${Date.now()}`
const SCRATCH_URL = (() => {
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`
  return url.toString()
})()

describe('UserStore: the system_admin role', () => {
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

  async function holder(role: 'system_admin' | 'operator') {
    const user = await users.createUser({ email: `p${++n}@example.com`, name: `P ${n}` })
    const membership = await users.addMembership(user.id, role, null)
    return { user, membership }
  }

  const reset = () => sql`DELETE FROM public.users`

  it('is platform-wide: a tenant is refused, and the grant is idempotent', async () => {
    await reset()
    const { user, membership } = await holder('system_admin')

    await expect(users.addMembership(user.id, 'system_admin', 'some-tenant')).rejects.toBeInstanceOf(UserInputError)
    expect(await users.addMembership(user.id, 'system_admin', null)).toMatchObject({ id: membership.id })
    expect(await users.listMemberships(user.id)).toHaveLength(1)
  })

  it('lets a user hold both system_admin and operator', async () => {
    await reset()
    const { user } = await holder('system_admin')

    await users.addMembership(user.id, 'operator', null)

    expect((await users.listMemberships(user.id)).map((m) => m.role).sort()).toEqual(['operator', 'system_admin'])
  })

  it('counts the last active system admin like the last operator: it cannot be disabled or demoted', async () => {
    await reset()
    const only = await holder('system_admin')

    await expect(users.setStatus(only.user.id, 'disabled')).rejects.toBeInstanceOf(LastOperatorError)
    await expect(users.removeMembership(only.user.id, only.membership.id)).rejects.toBeInstanceOf(LastOperatorError)
    expect(await users.listMemberships(only.user.id)).toHaveLength(1)
  })

  it('is satisfied by an operator, and the other way round: the platform needs one of either', async () => {
    await reset()
    const sa = await holder('system_admin')
    const op = await holder('operator')

    expect(await users.removeMembership(sa.user.id, sa.membership.id)).toBe(true) // the operator is left
    await expect(users.setStatus(op.user.id, 'disabled')).rejects.toBeInstanceOf(LastOperatorError)
  })

  it('does not count a disabled system admin as the one that is "left"', async () => {
    await reset()
    const a = await holder('system_admin')
    const b = await holder('system_admin')
    await users.setStatus(b.user.id, 'disabled')

    await expect(users.setStatus(a.user.id, 'disabled')).rejects.toBeInstanceOf(LastOperatorError)
  })

  it('allows dropping one of two platform roles when the user keeps the other', async () => {
    await reset()
    const both = await holder('system_admin')
    await users.addMembership(both.user.id, 'operator', null)

    expect(await users.removeMembership(both.user.id, both.membership.id)).toBe(true) // still an operator
    expect((await users.listMemberships(both.user.id)).map((m) => m.role)).toEqual(['operator'])
  })

  it('refuses to take both platform roles from the last administrator, one after the other', async () => {
    await reset()
    const both = await holder('system_admin')
    const op = await users.addMembership(both.user.id, 'operator', null)

    await users.removeMembership(both.user.id, both.membership.id)

    await expect(users.removeMembership(both.user.id, op.id)).rejects.toBeInstanceOf(LastOperatorError)
  })
})
