import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { provisionTenantSchema } from './tenantProvisioner.js'

// Migration 009 moves execution_events / webhook_registrations out of the shared public
// schema into each tenant's schema. This builds a scratch database at migration 008 with two
// tenants and old-style shared rows, applies 009, and checks where everything ended up.

const BASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const DB_NAME = `nexus_mig009_${Date.now()}`
const SCRATCH_URL = (() => {
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`
  return url.toString()
})()

const MIGRATIONS_BEFORE_009 = [
  '001_initial_schema.sql',
  '002_gateway_join_states_instance_idx.sql',
  '003_execution_events.sql',
  '004_definition_source_xml.sql',
  '005_webhooks.sql',
  '006_compensation_records.sql',
  '007_tenant_registry.sql',
  '008_tenant_default.sql',
]

function instanceRow(id: string) {
  return {
    id,
    definition_id: 'def',
    definition_version: 1,
    status: 'active',
    started_at: new Date(),
    data: JSON.stringify({}),
  }
}

describe('migration 009 (tenant-scoped events and webhooks)', () => {
  let admin: postgres.Sql
  let sql: postgres.Sql

  beforeAll(async () => {
    admin = postgres(BASE_URL)
    await admin.unsafe(`CREATE DATABASE "${DB_NAME}"`)
    sql = postgres(SCRATCH_URL)

    // Apply everything up to 008, the way runMigrations would
    await sql`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
    for (const file of MIGRATIONS_BEFORE_009) {
      const text = readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8')
      await sql.unsafe(text)
      await sql`INSERT INTO schema_migrations (version) VALUES (${file})`
    }

    // Two more tenants, each owning one instance
    await sql`INSERT INTO public.tenants (id, name, status) VALUES ('acme', 'Acme', 'active'), ('globex', 'Globex', 'active')`
    await provisionTenantSchema('acme', sql)
    await provisionTenantSchema('globex', sql)
    for (const [schema, id] of [['tenant_default', 'inst-default'], ['tenant_acme', 'inst-acme'], ['tenant_globex', 'inst-globex']] as const) {
      await sql`INSERT INTO ${sql(schema)}.instances ${sql(instanceRow(id))}`
    }
    // (provisionTenantSchema created the new-style tables too; drop them so the schemas
    // look like they did before migration 009)
    for (const schema of ['tenant_acme', 'tenant_globex', 'tenant_default']) {
      await sql`DROP TABLE IF EXISTS ${sql(schema)}.execution_events, ${sql(schema)}.webhook_registrations`
    }

    // Old-style shared rows
    const event = (id: string, instanceId: string | null) =>
      sql`INSERT INTO public.execution_events (id, instance_id, type, occurred_at, data)
          VALUES (${id}, ${instanceId}, 'ProcessInstanceStarted', now(), ${sql.json({ type: 'ProcessInstanceStarted' })})`
    await event('ev-default', 'inst-default')
    await event('ev-acme', 'inst-acme')
    await event('ev-globex', 'inst-globex')
    await event('ev-orphan', 'inst-deleted')
    await event('ev-no-instance', null)
    await sql`INSERT INTO public.webhook_registrations (url) VALUES ('https://example.com/hook')`

    await runMigrations(SCRATCH_URL)
  })

  afterAll(async () => {
    await sql.end()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
    await admin.end()
  })

  const eventIds = async (schema: string) =>
    (await sql<{ id: string }[]>`SELECT id FROM ${sql(schema)}.execution_events ORDER BY id`).map(r => r.id)

  it("puts each tenant's events in that tenant's schema", async () => {
    expect(await eventIds('tenant_acme')).toEqual(['ev-acme'])
    expect(await eventIds('tenant_globex')).toEqual(['ev-globex'])
  })

  it('hands events that belong to no tenant to the default tenant', async () => {
    expect(await eventIds('tenant_default')).toEqual(['ev-default', 'ev-no-instance', 'ev-orphan'])
  })

  it('moves webhook registrations to the default tenant only', async () => {
    const count = async (schema: string) =>
      (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM ${sql(schema)}.webhook_registrations`)[0]!.n
    expect(await count('tenant_default')).toBe(1)
    expect(await count('tenant_acme')).toBe(0)
    expect(await count('tenant_globex')).toBe(0)
  })

  it('drops the shared tables from the public schema', async () => {
    const rows = await sql`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename IN ('execution_events', 'webhook_registrations')
    `
    expect(rows).toHaveLength(0)
  })
})
