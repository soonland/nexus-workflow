import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { AuditLog, scrub } from './AuditLog.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('scrub', () => {
  it('drops fields whose name suggests a secret, at any depth', () => {
    const cleaned = scrub({
      name: 'ci',
      password: 'x',
      newPassword: 'x',
      token: 't',
      inviteToken: 't',
      plaintext: 'k',
      apiKey: 'k',
      secret: 's',
      passwordHash: 'h',
      Authorization: 'Bearer x',
      nested: { cookie: 'c', ok: 1, list: [{ secretValue: 's', keep: true }] },
    })

    expect(cleaned).toEqual({ name: 'ci', nested: { ok: 1, list: [{ keep: true }] } })
  })

  it('keeps ordinary facts, including ones that merely contain similar letters', () => {
    expect(scrub({ keyName: 'ci', keyId: 'abc', tenantId: 't', role: 'operator', count: 3 })).toEqual({ keyName: 'ci', keyId: 'abc', tenantId: 't', role: 'operator', count: 3 })
  })

  it('writes dates as text and stops at a sensible depth', () => {
    expect(scrub({ at: new Date('2026-01-01T00:00:00Z') })).toEqual({ at: '2026-01-01T00:00:00.000Z' })
    let deep: Record<string, unknown> = { leaf: 1 }
    for (let i = 0; i < 10; i++) deep = { next: deep }
    expect(JSON.stringify(scrub(deep))).toContain('[too deep]')
  })
})

describe('AuditLog (Postgres)', () => {
  const run = `au_${crypto.randomUUID().slice(0, 6)}`
  const tenantA = `${run}_a`
  const tenantB = `${run}_b`
  let sql: postgres.Sql
  let log: AuditLog

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    log = new AuditLog(sql)
  })

  afterAll(async () => {
    await sql`DELETE FROM public.audit_log WHERE action LIKE ${run + '%'}`
    await sql.end()
  })

  const mine = (extra: Partial<Parameters<AuditLog['list']>[0]> = {}) => log.list({ page: 0, pageSize: 100, actor: undefined, ...extra, action: extra.action ?? `${run}` })

  it('records who, what, where and a few facts', async () => {
    await log.record({
      action: `${run}.key.create`,
      actor: { kind: 'user', id: 'u1', label: 'ada@example.com' },
      tenantIds: [tenantA],
      target: 'key-1',
      details: { name: 'ci' },
    })

    const { entries } = await mine({ tenantId: tenantA })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      action: `${run}.key.create`,
      actor: { kind: 'user', id: 'u1', label: 'ada@example.com' },
      tenantIds: [tenantA],
      target: 'key-1',
      details: { name: 'ci' },
    })
    expect(entries[0]?.at).toBeInstanceOf(Date)
  })

  it('records the admin key and anonymous callers without an actor id', async () => {
    await log.record({ action: `${run}.tenant.create`, actor: { kind: 'adminKey' }, tenantIds: [tenantB] })
    await log.record({ action: `${run}.login.failure`, actor: { kind: 'anonymous', label: 'someone@example.com' } })

    const { entries } = await mine()
    const admin = entries.find((e) => e.action === `${run}.tenant.create`)
    const anon = entries.find((e) => e.action === `${run}.login.failure`)

    expect(admin?.actor).toEqual({ kind: 'adminKey', id: null, label: 'admin key' })
    expect(anon?.actor).toEqual({ kind: 'anonymous', id: null, label: 'someone@example.com' })
  })

  it('never stores a secret that is passed in details', async () => {
    await log.record({ action: `${run}.leak`, actor: { kind: 'adminKey' }, details: { password: 'hunter2', plaintext: 'nx_secret', token: 'tok', ok: 'fine' } })

    const [row] = await sql`SELECT details::text AS text FROM public.audit_log WHERE action = ${run + '.leak'}`

    expect(row?.['text']).toContain('fine')
    expect(row?.['text']).not.toMatch(/hunter2|nx_secret|tok"/)
  })

  it('clips and flattens text that came from outside', async () => {
    await log.record({ action: `${run}.clip`, actor: { kind: 'anonymous', label: `a\nb\t${'x'.repeat(2000)}` } })

    const { entries } = await mine({ action: `${run}.clip` })

    expect(entries[0]?.actor.label).not.toMatch(/[\n\t]/)
    expect(entries[0]?.actor.label?.length).toBeLessThanOrEqual(512)
  })

  it('does not throw when it cannot write, so a successful action is never turned into an error', async () => {
    const broken = new AuditLog(postgres(DATABASE_URL.replace(/\/[^/]+$/, '/no_such_database')))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(broken.record({ action: `${run}.x`, actor: { kind: 'adminKey' } })).resolves.toBeUndefined()

    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  describe('list', () => {
    beforeAll(async () => {
      const at = (day: number) => new Date(`2026-03-0${day}T12:00:00Z`)
      for (const [day, action, tenants, actorId] of [
        [1, 'tenant.update', [tenantA], 'u1'],
        [2, 'key.create', [tenantA], 'u1'],
        [3, 'key.revoke', [tenantB], 'u2'],
        [4, 'membership.add', [tenantA], 'u2'],
        [5, 'user.disable', [tenantA, tenantB], 'u1'], // a person who belongs to both
        [6, 'login.success', [], 'u1'], // platform-wide
      ] as const) {
        await sql`INSERT INTO public.audit_log (id, at, actor_kind, actor_id, action, tenant_ids) VALUES (${crypto.randomUUID()}, ${at(day)}, 'user', ${actorId}, ${run + '.l.' + action}, ${[...tenants]})`
      }
    })

    const listed = async (query: Partial<Parameters<AuditLog['list']>[0]> = {}) =>
      (await log.list({ page: 0, pageSize: 100, action: `${run}.l`, ...query })).entries.map((e) => e.action.replace(`${run}.l.`, ''))

    it('lists newest first', async () => {
      expect(await listed()).toEqual(['login.success', 'user.disable', 'membership.add', 'key.revoke', 'key.create', 'tenant.update'])
    })

    it('filters to the entries that involve a tenant, including ones shared with another', async () => {
      expect(await listed({ tenantId: tenantA })).toEqual(['user.disable', 'membership.add', 'key.create', 'tenant.update'])
      expect(await listed({ tenantId: tenantB })).toEqual(['user.disable', 'key.revoke'])
    })

    it('shows a tenant manager only entries that name tenants, all of them theirs', async () => {
      expect(await listed({ visibleToManagerOf: [tenantA] })).toEqual(['membership.add', 'key.create', 'tenant.update']) // not the one shared with B, not the platform-wide ones
      expect(await listed({ visibleToManagerOf: [tenantB] })).toEqual(['key.revoke'])
      expect(await listed({ visibleToManagerOf: [tenantA, tenantB] })).toEqual(['user.disable', 'membership.add', 'key.revoke', 'key.create', 'tenant.update'])
      expect(await listed({ visibleToManagerOf: [] })).toEqual([]) // a manager of nothing sees nothing
    })

    it('can combine the manager restriction with a tenant filter, and never widens it', async () => {
      expect(await listed({ visibleToManagerOf: [tenantA], tenantId: tenantB })).toEqual([])
    })

    it('filters by actor, by exact action, and by action family', async () => {
      expect(await listed({ actor: 'u2' })).toEqual(['membership.add', 'key.revoke'])
      expect(await log.list({ page: 0, pageSize: 10, action: `${run}.l.key.create` }).then((p) => p.total)).toBe(1)
      expect(await log.list({ page: 0, pageSize: 10, action: `${run}.l.key` }).then((p) => p.total)).toBe(2) // key.create + key.revoke
    })

    it('treats % and _ in a filter as plain characters', async () => {
      expect((await log.list({ page: 0, pageSize: 10, action: '%' })).total).toBe(0)
      expect((await log.list({ page: 0, pageSize: 10, action: `${run}_l` })).total).toBe(0) // "_" is not "any character"
    })

    it('filters by time range', async () => {
      expect(await listed({ from: new Date('2026-03-02T00:00:00Z'), to: new Date('2026-03-03T23:59:59Z') })).toEqual(['key.revoke', 'key.create'])
    })

    it('pages, with the total', async () => {
      const first = await log.list({ page: 0, pageSize: 3, action: `${run}.l` })
      const second = await log.list({ page: 1, pageSize: 3, action: `${run}.l` })

      expect(first.entries).toHaveLength(3)
      expect(second.entries).toHaveLength(3)
      expect(first.total).toBe(6)
      expect(second.total).toBe(6)
    })
  })
})
