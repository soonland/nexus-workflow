import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { dropTenantSchema, provisionTenantSchema } from './tenantProvisioner.js'
import { readTenantCounts } from './tenantCounts.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('readTenantCounts (Postgres)', () => {
  const tenantId = `cnt_${crypto.randomUUID().slice(0, 8)}`
  let sql: postgres.Sql

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    await provisionTenantSchema(tenantId, sql)
    const schema = `"tenant_${tenantId}"`
    const instance = (id: string, status: string) =>
      sql.unsafe(
        `INSERT INTO ${schema}.instances (id, definition_id, definition_version, status, started_at, data) VALUES ('${id}', 'secret-process', 1, '${status}', now(), '{}')`,
      )
    for (const [id, status] of [['i1', 'active'], ['i2', 'active'], ['i3', 'suspended'], ['i4', 'terminated'], ['i5', 'completed'], ['i6', 'completed'], ['i7', 'completed']] as const) {
      await instance(id, status)
    }
    const task = (id: string, status: string) =>
      sql.unsafe(`INSERT INTO ${schema}.user_tasks (id, instance_id, status, data) VALUES ('${id}', 'i1', '${status}', '{}')`)
    for (const [id, status] of [['t1', 'open'], ['t2', 'open'], ['t3', 'claimed'], ['t4', 'completed'], ['t5', 'cancelled']] as const) {
      await task(id, status)
    }
  })

  afterAll(async () => {
    await dropTenantSchema(tenantId, sql)
    await sql.end()
  })

  it('counts instances by status, with zero for statuses that have none', async () => {
    const counts = await readTenantCounts(sql, tenantId)

    expect(counts.instances).toEqual({ pending: 0, active: 2, suspended: 1, completed: 3, terminated: 1 })
  })

  it('counts tasks that are not finished (open and claimed)', async () => {
    expect((await readTenantCounts(sql, tenantId)).pendingTasks).toBe(3)
  })

  it('returns numbers and nothing that describes the tenant\'s workflows', async () => {
    const json = JSON.stringify(await readTenantCounts(sql, tenantId))

    expect(json).not.toContain('secret-process')
    expect(Object.keys(JSON.parse(json) as object).sort()).toEqual(['instances', 'pendingTasks'])
  })

  it('gives up on a tenant that is too slow to count, instead of tying up a connection', async () => {
    // a lock held by another connection makes the count wait; the statement timeout ends the wait
    const holder = await sql.reserve()
    await holder.unsafe('BEGIN')
    await holder.unsafe(`LOCK TABLE "tenant_${tenantId}".instances IN ACCESS EXCLUSIVE MODE`)
    try {
      await expect(readTenantCounts(sql, tenantId, 200)).rejects.toThrow(/statement timeout/i)
    } finally {
      await holder.unsafe('ROLLBACK')
      holder.release()
    }
    expect((await readTenantCounts(sql, tenantId)).pendingTasks).toBe(3) // fine again afterwards
  })

  it('refuses a tenant id that could escape the schema name', async () => {
    await expect(readTenantCounts(sql, 'x"; drop schema public; --')).rejects.toThrow(/invalid tenantId/i)
  })

  it('fails for a tenant whose schema does not exist', async () => {
    await expect(readTenantCounts(sql, 'no_such_tenant_here')).rejects.toThrow()
  })
})
