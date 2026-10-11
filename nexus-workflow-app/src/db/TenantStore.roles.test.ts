import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { TenantStore } from './TenantStore.js'
import { UserStore } from './UserStore.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('API key roles (Postgres)', () => {
  const prefix = `kr_${crypto.randomUUID().slice(0, 6)}`
  const tenantId = `${prefix}_t`
  const otherTenant = `${prefix}_o`
  let sql: postgres.Sql
  let store: TenantStore
  let userId = ''

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    store = new TenantStore(sql, 'role-test-secret')
    await store.createTenant(tenantId, 'Tenant')
    await store.createTenant(otherTenant, 'Other')
    userId = (await new UserStore(sql).createUser({ email: `${prefix}.maker@example.com`, name: 'Maker' })).id
  })

  afterAll(async () => {
    await sql`DELETE FROM public.api_keys WHERE tenant_id LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.users WHERE email LIKE ${prefix + '.%'}`
    await sql.end()
  })

  it('a new key is a service key unless a role is asked for (least privilege)', async () => {
    const { key } = await store.createApiKey(tenantId, 'plain')
    expect(key.role).toBe('service')
    expect(key.createdBy).toBeNull()
  })

  it('records the role and who created the key, and lists them', async () => {
    const { key } = await store.createApiKey(tenantId, 'erp', { role: 'tenant_manager', createdBy: userId })

    expect(key).toMatchObject({ role: 'tenant_manager', createdBy: userId })
    const listed = (await store.listApiKeys(tenantId)).find((k) => k.id === key.id)
    expect(listed).toMatchObject({ role: 'tenant_manager', createdBy: userId, name: 'erp' })
  })

  it('refuses a role that does not exist (the database says so too)', async () => {
    await expect(sql`UPDATE public.api_keys SET role = 'god' WHERE tenant_id = ${tenantId}`).rejects.toThrow(/api_keys_role_check/)
  })

  it('changes a role and says what it was, without changing the secret', async () => {
    const { key, plaintext } = await store.createApiKey(tenantId, 'raise me')

    const changed = await store.setApiKeyRole(tenantId, key.id, 'tenant_manager')

    expect(changed?.previous).toBe('service')
    expect(changed?.key.role).toBe('tenant_manager')
    // the same secret still finds the same key, now with the new role
    expect((await store.findActiveKey(plaintext))?.role).toBe('tenant_manager')
    expect((await store.setApiKeyRole(tenantId, key.id, 'service'))?.previous).toBe('tenant_manager')
  })

  it('does not change a key that is revoked, unknown, or belongs to another tenant', async () => {
    const revoked = (await store.createApiKey(tenantId, 'gone')).key
    await store.revokeApiKey(tenantId, revoked.id)
    const mine = (await store.createApiKey(tenantId, 'mine')).key

    expect(await store.setApiKeyRole(tenantId, revoked.id, 'tenant_manager')).toBeNull()
    expect(await store.setApiKeyRole(tenantId, 'no-such-key', 'tenant_manager')).toBeNull()
    expect(await store.setApiKeyRole(otherTenant, mine.id, 'tenant_manager')).toBeNull() // another tenant's admin cannot reach it
    expect((await store.listApiKeys(tenantId)).find((k) => k.id === mine.id)?.role).toBe('service')
  })

  it('keeps the key when its creator is deleted', async () => {
    const maker = await new UserStore(sql).createUser({ email: `${prefix}.leaver@example.com`, name: 'Leaver' })
    const { key } = await store.createApiKey(tenantId, 'orphan', { createdBy: maker.id })

    await sql`DELETE FROM public.users WHERE id = ${maker.id}`

    const kept = (await store.listApiKeys(tenantId)).find((k) => k.id === key.id)
    expect(kept).toBeDefined()
    expect(kept?.createdBy).toBeNull()
  })

  describe('findActiveKey', () => {
    it('finds an active key by its secret, and not a revoked one or an unknown secret', async () => {
      const { key, plaintext } = await store.createApiKey(tenantId, 'lookup')
      expect((await store.findActiveKey(plaintext))?.id).toBe(key.id)
      expect(await store.findActiveKey('not-a-key')).toBeNull()

      await store.revokeApiKey(tenantId, key.id)
      expect(await store.findActiveKey(plaintext)).toBeNull()
    })

    it('does not find the key of a suspended tenant', async () => {
      const { plaintext } = await store.createApiKey(otherTenant, 'suspended')
      await store.updateTenant(otherTenant, { status: 'suspended' })

      expect(await store.findActiveKey(plaintext)).toBeNull()
    })
  })
})
