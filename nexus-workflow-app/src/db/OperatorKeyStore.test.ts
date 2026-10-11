import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { OPERATOR_KEY_PREFIX, OperatorKeyStore } from './OperatorKeyStore.js'
import { UserStore } from './UserStore.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('OperatorKeyStore (Postgres)', () => {
  const prefix = `ok_${crypto.randomUUID().slice(0, 6)}`
  let sql: postgres.Sql
  let store: OperatorKeyStore
  let userId = ''

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    store = new OperatorKeyStore(sql, 'operator-key-test-secret')
    userId = (await new UserStore(sql).createUser({ email: `${prefix}.maker@example.com`, name: 'Maker' })).id
  })

  afterAll(async () => {
    await sql`DELETE FROM public.operator_keys WHERE name LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql.end()
  })

  const make = (suffix: string, options?: Parameters<OperatorKeyStore['create']>[1]) => store.create(`${prefix} ${suffix}`, options)

  it('creates a key whose secret starts with nxop_ and is not stored', async () => {
    const { key, plaintext } = await make('plain')

    expect(plaintext.startsWith(OPERATOR_KEY_PREFIX)).toBe(true)
    expect(plaintext.length).toBeGreaterThan(40)
    const [row] = await sql`SELECT key_hash FROM public.operator_keys WHERE id = ${key.id}`
    expect(row?.['key_hash']).not.toContain(plaintext)
    expect(JSON.stringify(key)).not.toContain(plaintext)
    expect(key).toMatchObject({ name: `${prefix} plain`, createdBy: null, expiresAt: null, revokedAt: null, lastUsedAt: null })
  })

  it('records who made it and when it expires', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000)

    const { key } = await make('dated', { createdBy: userId, expiresAt })

    expect(key.createdBy).toBe(userId)
    expect(key.expiresAt?.getTime()).toBe(expiresAt.getTime())
  })

  it('finds a key by its secret and marks it used', async () => {
    const { key, plaintext } = await make('use me')

    const found = await store.authenticate(plaintext)

    expect(found?.id).toBe(key.id)
    // last_used_at is written without making the caller wait: give it a moment
    await new Promise((resolve) => setTimeout(resolve, 100))
    const [row] = await sql`SELECT last_used_at FROM public.operator_keys WHERE id = ${key.id}`
    expect(row?.['last_used_at']).toBeInstanceOf(Date)
  })

  it('does not find a key by a wrong secret, a lookalike, or something without the prefix', async () => {
    const { plaintext } = await make('real')

    expect(await store.authenticate(plaintext + 'x')).toBeNull()
    expect(await store.authenticate(OPERATOR_KEY_PREFIX + 'a'.repeat(64))).toBeNull()
    expect(await store.authenticate(plaintext.slice(OPERATOR_KEY_PREFIX.length))).toBeNull() // right secret, no prefix
    expect(await store.authenticate('')).toBeNull()
  })

  it('refuses a revoked key, and a revoke that finds nothing says so', async () => {
    const { key, plaintext } = await make('revoke me')

    expect(await store.revoke(key.id)).toBe(true)
    expect(await store.authenticate(plaintext)).toBeNull()
    expect(await store.revoke(key.id)).toBe(false) // already revoked
    expect(await store.revoke('no-such-key')).toBe(false)
  })

  it('refuses an expired key', async () => {
    const { key, plaintext } = await make('short lived', { expiresAt: new Date(Date.now() + 60_000) })
    expect(await store.authenticate(plaintext)).not.toBeNull()

    await sql`UPDATE public.operator_keys SET expires_at = now() - interval '1 second' WHERE id = ${key.id}`

    expect(await store.authenticate(plaintext)).toBeNull()
  })

  it('lists every key, revoked and expired ones too, without any secret or hash', async () => {
    const live = await make('list live')
    const gone = await make('list gone')
    await store.revoke(gone.key.id)

    const listed = (await store.list()).filter((k) => k.name.startsWith(`${prefix} list`))

    expect(listed.map((k) => k.id).sort()).toEqual([live.key.id, gone.key.id].sort())
    expect(listed.find((k) => k.id === gone.key.id)?.revokedAt).toBeInstanceOf(Date)
    expect(JSON.stringify(listed)).not.toMatch(/key_hash|keyHash|nxop_/)
  })

  it('keeps the key when the person who created it is deleted', async () => {
    const leaver = await new UserStore(sql).createUser({ email: `${prefix}.leaver@example.com`, name: 'Leaver' })
    const { key } = await make('orphan', { createdBy: leaver.id })

    await sql`DELETE FROM public.users WHERE id = ${leaver.id}`

    const kept = (await store.list()).find((k) => k.id === key.id)
    expect(kept?.createdBy).toBeNull()
  })

  it('refuses a blank or over-long name at the database too', async () => {
    await expect(sql`INSERT INTO public.operator_keys (id, name, key_hash) VALUES ('x1', '   ', 'h1')`).rejects.toThrow(/operator_keys_name_not_blank/)
    await expect(sql`INSERT INTO public.operator_keys (id, name, key_hash) VALUES ('x2', ${'n'.repeat(256)}, 'h2')`).rejects.toThrow(/operator_keys_name_not_blank/)
  })
})
