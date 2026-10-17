import { readFileSync } from 'node:fs'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'

// Migration 015 adds the system_admin role. This builds a scratch database with memberships written
// *before* it (the way existing installations have them) and checks that they survive and that the
// constraint now accepts the new role, and only it.

const BASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'
const DB_NAME = `nexus_mig015_${Date.now()}`
const SCRATCH_URL = (() => {
  const url = new URL(BASE_URL)
  url.pathname = `/${DB_NAME}`
  return url.toString()
})()

const BEFORE_015 = [
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
  '013_api_key_roles.sql',
  '014_operator_keys.sql',
]

describe('migration 015 (the system_admin role)', () => {
  let admin: postgres.Sql
  let sql: postgres.Sql

  beforeAll(async () => {
    admin = postgres(BASE_URL)
    await admin.unsafe(`CREATE DATABASE "${DB_NAME}"`)
    sql = postgres(SCRATCH_URL)
    await sql`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`
    for (const file of BEFORE_015) {
      await sql.unsafe(readFileSync(new URL(`./migrations/${file}`, import.meta.url), 'utf8'))
      await sql`INSERT INTO schema_migrations (version) VALUES (${file})`
    }
    await sql`INSERT INTO public.tenants (id, name, status) VALUES ('acme', 'Acme', 'active')`
    await sql`INSERT INTO public.users (id, email, name) VALUES ('u-op', 'op@example.com', 'Op'), ('u-mgr', 'mgr@example.com', 'Mgr'), ('u-new', 'new@example.com', 'New')`
    await sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m-op', 'u-op', 'operator', NULL), ('m-mgr', 'u-mgr', 'tenant_manager', 'acme')`

    await sql.unsafe(readFileSync(new URL('./migrations/015_system_admin_role.sql', import.meta.url), 'utf8'))
  })

  afterAll(async () => {
    await sql.end()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${DB_NAME}" WITH (FORCE)`)
    await admin.end()
  })

  it('keeps every existing membership as it was: nobody becomes a system admin', async () => {
    const rows = await sql<Array<{ id: string; role: string; tenant_id: string | null }>>`SELECT id, role, tenant_id FROM public.memberships ORDER BY id`

    expect(rows).toEqual([
      { id: 'm-mgr', role: 'tenant_manager', tenant_id: 'acme' },
      { id: 'm-op', role: 'operator', tenant_id: null },
    ])
  })

  it('accepts a platform-wide system_admin, once per user', async () => {
    await sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m-sa', 'u-new', 'system_admin', NULL)`

    await expect(sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m-sa-2', 'u-new', 'system_admin', NULL)`).rejects.toThrow(/memberships_one_system_admin_per_user/)
  })

  it('lets one user hold system_admin and operator together', async () => {
    await sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m-new-op', 'u-new', 'operator', NULL)`

    const rows = await sql`SELECT 1 FROM public.memberships WHERE user_id = 'u-new'`
    expect(rows).toHaveLength(2)
  })

  it('refuses a system_admin tied to a tenant, and still refuses an unknown role', async () => {
    await expect(sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m-bad-1', 'u-mgr', 'system_admin', 'acme')`).rejects.toThrow(/memberships_role_scope/)
    await expect(sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m-bad-2', 'u-mgr', 'root', NULL)`).rejects.toThrow(/memberships_role_scope/)
  })

  it('keeps the old rules: a tenant manager needs a tenant, an operator must have none', async () => {
    await expect(sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m-bad-3', 'u-op', 'tenant_manager', NULL)`).rejects.toThrow(/memberships_role_scope/)
    await expect(sql`INSERT INTO public.memberships (id, user_id, role, tenant_id) VALUES ('m-bad-4', 'u-mgr', 'operator', 'acme')`).rejects.toThrow(/memberships_role_scope/)
  })
})
