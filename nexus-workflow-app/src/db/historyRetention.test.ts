import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { dropTenantSchema, provisionTenantSchema } from './tenantProvisioner.js'
import { purgeHistorySnapshots } from './historyRetention.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('purgeHistorySnapshots (Postgres)', () => {
  const tenantId = `ret_${crypto.randomUUID().slice(0, 8)}`
  const schema = `"tenant_${tenantId}"`
  let sql: postgres.Sql

  const instance = (id: string, status: string, completedDaysAgo: number | null) =>
    sql.unsafe(
      `INSERT INTO ${schema}.instances (id, definition_id, definition_version, status, started_at, completed_at, data)
       VALUES ('${id}', 'p', 1, '${status}', now() - interval '100 days',
               ${completedDaysAgo === null ? 'NULL' : `now() - interval '${completedDaysAgo} days'`}, '{}')`,
    )
  const entry = (id: string, instanceId: string) =>
    sql.unsafe(
      `INSERT INTO ${schema}.history_entries (id, instance_id, started_at, data)
       VALUES ('${id}', '${instanceId}', now() - interval '100 days',
               '{"id":"${id}","elementId":"t","variablesSnapshot":{"password":"hunter2"}}')`,
    )
  const data = async (id: string) =>
    (await sql.unsafe<Array<{ data: Record<string, unknown> }>>(`SELECT data FROM ${schema}.history_entries WHERE id = '${id}'`))[0]!.data

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    await provisionTenantSchema(tenantId, sql)
    await instance('old-done', 'completed', 40)
    await instance('old-term', 'terminated', 40)
    await instance('new-done', 'completed', 5)
    await instance('running', 'active', null)
    for (const [e, i] of [['e1', 'old-done'], ['e2', 'old-term'], ['e3', 'new-done'], ['e4', 'running']] as const) await entry(e, i)
  })

  afterAll(async () => {
    await dropTenantSchema(tenantId, sql)
    await sql.end()
  })

  it('removes snapshots of instances finished longer ago than the retention, and only those', async () => {
    const stripped = await purgeHistorySnapshots(sql, tenantId, 30)

    expect(stripped).toBe(2)
    expect(await data('e1')).not.toHaveProperty('variablesSnapshot')
    expect(await data('e2')).not.toHaveProperty('variablesSnapshot')
    expect(await data('e3')).toHaveProperty('variablesSnapshot')
    expect(await data('e4')).toHaveProperty('variablesSnapshot')
  })

  it('keeps the rest of the step record', async () => {
    expect(await data('e1')).toMatchObject({ id: 'e1', elementId: 't' })
  })

  it('is a no-op when run again', async () => {
    expect(await purgeHistorySnapshots(sql, tenantId, 30)).toBe(0)
  })
})
