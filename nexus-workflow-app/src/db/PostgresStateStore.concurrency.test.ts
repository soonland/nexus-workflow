import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import postgres from 'postgres'
import { ConcurrentModificationError, type ProcessInstance } from 'nexus-workflow-core'
import { PostgresStateStore } from './PostgresStateStore.js'
import { runMigrations } from './migrate.js'
import { migrateTenantSchema, TENANT_MIGRATIONS } from './tenantMigrations.js'

const TEST_DB_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const hasDb = Boolean(process.env['DATABASE_URL'])

function makeInstance(overrides: Partial<ProcessInstance> = {}): ProcessInstance {
  return {
    id: 'inst-cc',
    definitionId: 'def-1',
    definitionVersion: 1,
    status: 'active',
    rootScopeId: 'scope-root',
    startedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe.skipIf(!hasDb)('PostgresStateStore optimistic concurrency', () => {
  let store: PostgresStateStore
  let sql: ReturnType<typeof postgres>

  // A tenant of its own, so these tests do not race the other files that truncate `default`.
  const tenantId = `cc_${crypto.randomUUID().slice(0, 8).replace(/-/g, '')}`

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL)
    await runMigrations(TEST_DB_URL)
    await migrateTenantSchema(sql, `tenant_${tenantId}`)
    store = new PostgresStateStore(TEST_DB_URL, tenantId)
  })

  afterAll(async () => {
    await store.close()
    await sql.unsafe(`DROP SCHEMA IF EXISTS "tenant_${tenantId}" CASCADE`)
    await sql.end()
  })

  beforeEach(async () => {
    await sql.unsafe(`TRUNCATE "tenant_${tenantId}".instances, "tenant_${tenantId}".tokens CASCADE`)
  })

  it('a new instance is at version 1 and each update bumps it', async () => {
    await store.createInstance(makeInstance())
    const v1 = (await store.getInstance('inst-cc'))!
    expect(v1.version).toBe(1)

    await store.updateInstance({ ...v1, status: 'suspended' })
    const v2 = (await store.getInstance('inst-cc'))!
    expect(v2.version).toBe(2)
    expect(v2.status).toBe('suspended')
  })

  it('rejects an update made from a stale version and leaves the first write in place', async () => {
    await store.createInstance(makeInstance())
    const first = (await store.getInstance('inst-cc'))!
    const second = (await store.getInstance('inst-cc'))!

    await store.updateInstance({ ...first, status: 'suspended' })
    await expect(store.updateInstance({ ...second, status: 'terminated' })).rejects.toBeInstanceOf(ConcurrentModificationError)

    const now = (await store.getInstance('inst-cc'))!
    expect(now.status).toBe('suspended')
    expect(now.version).toBe(2)
  })

  it('a conflicting executeTransaction writes nothing at all', async () => {
    await store.createInstance(makeInstance())
    const stale = (await store.getInstance('inst-cc'))!
    await store.updateInstance({ ...stale, status: 'suspended' })

    await expect(store.executeTransaction([
      { op: 'updateInstance', instance: { ...stale, status: 'terminated' } },
      {
        op: 'saveTokens',
        tokens: [{
          id: 'tok-cc', instanceId: 'inst-cc', elementId: 'task-1', elementType: 'serviceTask',
          status: 'active', scopeId: 's', createdAt: new Date(), updatedAt: new Date(),
        }],
      },
    ])).rejects.toBeInstanceOf(ConcurrentModificationError)

    expect(await store.getAllTokens('inst-cc')).toEqual([])
  })

  it('of several writers racing from the same loaded state exactly one persists', async () => {
    await store.createInstance(makeInstance())
    const loaded = (await store.getInstance('inst-cc'))!

    const statuses = ['suspended', 'terminated', 'completed', 'suspended', 'terminated'] as const
    const attempts = await Promise.allSettled(
      statuses.map(status =>
        store.executeTransaction([{ op: 'updateInstance', instance: { ...loaded, status } }]),
      ),
    )

    expect(attempts.filter(a => a.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.filter((a): a is PromiseRejectedResult => a.status === 'rejected')
    expect(rejected).toHaveLength(4)
    for (const r of rejected) expect(r.reason).toBeInstanceOf(ConcurrentModificationError)
    expect((await store.getInstance('inst-cc'))!.version).toBe(2)
  })

  it('an instance row that predates the version column reads as version 1', async () => {
    const schema = `tenant_cc_${crypto.randomUUID().slice(0, 6).replace(/-/g, '')}`
    try {
      // Bring the schema only to the baseline, then insert a row the way old code would have.
      await migrateTenantSchema(sql, schema, TENANT_MIGRATIONS.slice(0, 1))
      await sql.unsafe(
        `INSERT INTO "${schema}".instances (id, definition_id, definition_version, status, started_at, data)
         VALUES ('old', 'd', 1, 'active', now(), '{"id":"old","definitionId":"d","definitionVersion":1,"status":"active","rootScopeId":"r","startedAt":"2024-01-01T00:00:00.000Z"}')`,
      )
      await migrateTenantSchema(sql, schema)
      const rows = await sql.unsafe(`SELECT version FROM "${schema}".instances WHERE id = 'old'`)
      expect(rows[0]?.['version']).toBe(1)
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    }
  })
})
