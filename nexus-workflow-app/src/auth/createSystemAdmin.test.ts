import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { InviteStore } from '../db/InviteStore.js'
import { runMigrations } from '../db/migrate.js'
import { UserStore } from '../db/UserStore.js'
import { createSystemAdminWithInvite, removeSystemAdmin } from './createSystemAdmin.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('createSystemAdminWithInvite (Postgres)', () => {
  const prefix = `csa_${crypto.randomUUID().slice(0, 6)}`
  const email = (name: string) => `${prefix}.${name}@example.com`
  let sql: postgres.Sql
  let users: UserStore
  let invites: InviteStore
  const hmacSecret = 'create-system-admin-secret'

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    users = new UserStore(sql)
    invites = new InviteStore(sql, { hmacSecret, ttlMs: 3_600_000 })
  })

  afterAll(async () => {
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql.end()
  })

  const run = (input: { email: string; name?: string }) => createSystemAdminWithInvite(sql, { hmacSecret, inviteTtlMs: 3_600_000 }, input)

  it('creates the system admin and a one-time invite that sets their password', async () => {
    const result = await run({ email: email('first'), name: 'First Admin' })

    expect(result.created).toBe(true)
    expect(result.user).toMatchObject({ email: email('first'), name: 'First Admin', status: 'active', hasPassword: false })
    expect((await users.listMemberships(result.user.id)).map((m) => m.role)).toEqual(['system_admin'])
    expect(await invites.inspect(result.invite.token)).toMatchObject({ email: email('first') })
  })

  it('can be run for several people: each becomes a system admin', async () => {
    const a = await run({ email: email('multi-a') })
    const b = await run({ email: email('multi-b') })

    expect(a.user.id).not.toBe(b.user.id)
    expect((await users.listMemberships(a.user.id)).map((m) => m.role)).toEqual(['system_admin'])
    expect((await users.listMemberships(b.user.id)).map((m) => m.role)).toEqual(['system_admin'])
  })

  it('is safe to run again: the same person, still one system_admin role, a fresh invite that replaces the old one', async () => {
    const first = await run({ email: email('again'), name: 'Again' })

    const second = await run({ email: email('again') })

    expect(second.created).toBe(false)
    expect(second.user.id).toBe(first.user.id)
    expect(await users.listMemberships(first.user.id)).toHaveLength(1)
    expect(await invites.inspect(first.invite.token)).toBeNull()
    expect(await invites.inspect(second.invite.token)).not.toBeNull()
  })

  it('turns an existing operator into a system admin, keeping the operator role', async () => {
    const existing = await users.createUser({ email: email('promote'), name: 'Promote Me' })
    await users.addMembership(existing.id, 'operator', null)

    await run({ email: email('promote') })

    expect((await users.listMemberships(existing.id)).map((m) => m.role).sort()).toEqual(['operator', 'system_admin'])
  })

  it('re-enables a disabled account: this is the way back in when access is lost', async () => {
    const locked = await users.createUser({ email: email('locked'), name: 'Locked' })
    await users.setStatus(locked.id, 'disabled')

    const result = await run({ email: email('locked') })

    expect(result.user.status).toBe('active')
    expect(await invites.inspect(result.invite.token)).not.toBeNull()
  })

  it('rejects an email that is not an email, creating nothing', async () => {
    await expect(run({ email: 'not-an-email' })).rejects.toThrow(/email/i)
  })

  describe('removeSystemAdmin', () => {
    it('takes the role away and keeps the account and its other roles', async () => {
      await run({ email: email('keeper') }) // another administrator, so the platform keeps one
      const leaving = await run({ email: email('leaving') })
      await users.addMembership(leaving.user.id, 'operator', null)

      const result = await removeSystemAdmin(sql, { email: email('leaving') })

      expect(result.removed).toBe(true)
      expect((await users.listMemberships(leaving.user.id)).map((m) => m.role)).toEqual(['operator'])
      expect(await users.findById(leaving.user.id)).not.toBeNull()
    })

    it('says so when the person is not a system admin, and fails for an unknown email', async () => {
      await users.createUser({ email: email('plain'), name: 'Plain' })

      expect(await removeSystemAdmin(sql, { email: email('plain') })).toMatchObject({ removed: false })
      await expect(removeSystemAdmin(sql, { email: email('nobody') })).rejects.toThrow(/no user/i)
    })
  })
})
