import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'

// Migration 013 gives API keys a role. This builds a scratch database with keys written *before* it
// (the way existing installations have them) and checks what they become.

const BASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const DB_NAME = `nexus_mig013_${Date.now()}`
const SCRATCH_URL = (() => {
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`
  return url.toString()
})()

const BEFORE_013 = [
  '001_initial_schema.sql',
  '002_gateway_join_states_instance_idx.sql',
  '003_execution_events.sql',
  '004_definition_source_xml.sql',
  '005_webhooks.sql',
  '006_compensation_records.sql',
  '007_tenant_registry.sql',
  '008_tenant_default.sql',
  '009_tenant_events_webhooks.sql',
  '010_tenant_deleting_status.sql',
  '011_users.sql',
  '012_audit_log.sql',
]

describe('migration 013 (roles on API keys)', () => {
  let admin: postgres.Sql
  let sql: postgres.Sql

  beforeAll(async () => {
    admin = postgres(BASE_URL)
    await admin.unsafe(`CREATE DATABASE "${DB_NAME}"`)
    sql = postgres(SCRATCH_URL)
    await sql`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
    for (const file of BEFORE_013) {
      await sql.unsafe(readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'))
      await sql`INSERT INTO schema_migrations (version) VALUES (${file})`
    }
    await sql`INSERT INTO public.tenants (id, name, status) VALUES ('acme', 'Acme', 'active')`
    await sql`INSERT INTO public.api_keys (id, tenant_id, name, key_hash) VALUES ('old-1', 'acme', 'erp', 'hash-1'), ('old-2', 'acme', 'revoked one', 'hash-2')`
    await sql`UPDATE public.api_keys SET revoked_at = now() WHERE id = 'old-2'`

    await sql.unsafe(readFileSync(new URL('./migrations/013_api_key_roles.sql', import.meta.url), 'utf8'))
  })

  afterAll(async () => {
    await sql.end()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
    await admin.end()
  })

  it('turns every existing key, active or revoked, into a service key with no recorded creator', async () => {
    const rows = await sql<Array<{ id: string; role: string; created_by: string | null }>>`SELECT id, role, created_by FROM public.api_keys ORDER BY id`

    expect(rows).toEqual([
      { id: 'old-1', role: 'service', created_by: null },
      { id: 'old-2', role: 'service', created_by: null },
    ])
  })

  it('keeps the keys usable: same hash, same tenant, still revoked where it was', async () => {
    const rows = await sql<Array<{ id: string; key_hash: string; tenant_id: string; revoked_at: Date | null }>>`SELECT id, key_hash, tenant_id, revoked_at FROM public.api_keys ORDER BY id`

    expect(rows.map((r) => [r.id, r.key_hash, r.tenant_id, r.revoked_at !== null])).toEqual([
      ['old-1', 'hash-1', 'acme', false],
      ['old-2', 'hash-2', 'acme', true],
    ])
  })

  it('makes a key written the old way (no role given) a service key', async () => {
    await sql`INSERT INTO public.api_keys (id, tenant_id, name, key_hash) VALUES ('legacy-writer', 'acme', 'old code path', 'hash-3')`

    const [row] = await sql<Array<{ role: string }>>`SELECT role FROM public.api_keys WHERE id = 'legacy-writer'`
    expect(row?.role).toBe('service')
  })

  it('only allows the two roles', async () => {
    await expect(sql`INSERT INTO public.api_keys (id, tenant_id, name, key_hash, role) VALUES ('bad', 'acme', 'x', 'h', 'operator')`).rejects.toThrow(/api_keys_role_check/)
  })
})
