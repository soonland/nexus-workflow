import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { InviteStore } from '../db/InviteStore.js'
import { runMigrations } from '../db/migrate.js'
import { UserStore } from '../db/UserStore.js'
import { createOperatorWithInvite } from './createOperator.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('createOperatorWithInvite (Postgres)', () => {
  const prefix = `co_${crypto.randomUUID().slice(0, 6)}`
  const email = (name: string) => `${prefix}.${name}@example.com`
  let sql: postgres.Sql
  let users: UserStore
  let invites: InviteStore
  const hmacSecret = 'create-operator-secret'

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

  const run = (input: { email: string; name?: string }) => createOperatorWithInvite(sql, { hmacSecret, inviteTtlMs: 3_600_000 }, input)

  it('creates the operator and a one-time invite that sets their password', async () => {
    const result = await run({ email: email('first'), name: 'First Operator' })

    expect(result.created).toBe(true)
    expect(result.user).toMatchObject({ email: email('first'), name: 'First Operator', status: 'active', hasPassword: false })
    expect((await users.listMemberships(result.user.id)).map((m) => m.role)).toEqual(['operator'])
    expect(await invites.inspect(result.invite.token)).toMatchObject({ email: email('first') })
  })

  it('names the operator after the part of the email before the @ when no name is given', async () => {
    const result = await run({ email: email('anon') })
    expect(result.user.name).toBe(`${prefix}.anon`)
  })

  it('is safe to run again: the same person, still one operator role, a fresh invite that replaces the old one', async () => {
    const first = await run({ email: email('again'), name: 'Again' })

    const second = await run({ email: email('again') })

    expect(second.created).toBe(false)
    expect(second.user.id).toBe(first.user.id)
    expect(await users.listMemberships(first.user.id)).toHaveLength(1)
    expect(await invites.inspect(first.invite.token)).toBeNull()
    expect(await invites.inspect(second.invite.token)).not.toBeNull()
  })

  it('turns an existing ordinary account into an operator', async () => {
    const existing = await users.createUser({ email: email('promote'), name: 'Promote Me' })

    const result = await run({ email: email('promote') })

    expect(result.created).toBe(false)
    expect(result.user.id).toBe(existing.id)
    expect((await users.listMemberships(existing.id)).map((m) => m.role)).toEqual(['operator'])
  })

  it('re-enables a disabled account: this is the way back in when every operator is locked out', async () => {
    const locked = await users.createUser({ email: email('locked'), name: 'Locked' })
    await users.setStatus(locked.id, 'disabled')

    const result = await run({ email: email('locked') })

    expect(result.user.status).toBe('active')
    expect(await invites.inspect(result.invite.token)).not.toBeNull()
  })

  it('rejects an email that is not an email, creating nothing', async () => {
    await expect(run({ email: 'not-an-email' })).rejects.toThrow(/email/i)
  })
})
