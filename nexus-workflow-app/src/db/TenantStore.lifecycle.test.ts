import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { runMigrations } from './migrate.js'
import { TenantStore } from './TenantStore.js'

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('TenantStore lifecycle (Postgres)', () => {
  const prefix = `life_${crypto.randomUUID().slice(0, 6)}`
  const idA = `${prefix}_a`
  const idB = `${prefix}_b`
  let sql: postgres.Sql
  let store: TenantStore

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    sql = postgres(DATABASE_URL)
    store = new TenantStore(sql, 'lifecycle-secret')
    await store.createTenant(idA, 'Tenant A')
    await store.createTenant(idB, 'Tenant B')
  })

  afterAll(async () => {
    await sql`DELETE FROM public.api_keys WHERE tenant_id LIKE ${prefix + '%'}`
    await sql`DELETE FROM public.tenants WHERE id LIKE ${prefix + '%'}`
    await sql.end()
  })

  describe('listTenants', () => {
    it('lists tenants with their number of active keys', async () => {
      const first = await store.createApiKey(idA, 'one')
      await store.createApiKey(idA, 'two')
      await store.revokeApiKey(idA, first.key.id)

      const tenants = await store.listTenants()

      const a = tenants.find(t => t.id === idA)
      const b = tenants.find(t => t.id === idB)
      expect(a).toMatchObject({ id: idA, name: 'Tenant A', status: 'active', activeKeyCount: 1 })
      expect(b).toMatchObject({ id: idB, activeKeyCount: 0 })
      expect(a!.createdAt).toBeInstanceOf(Date)
    })

    it('is ordered by creation date', async () => {
      const ids = (await store.listTenants()).map(t => t.id)
      expect(ids.indexOf(idA)).toBeLessThan(ids.indexOf(idB))
    })
  })

  describe('updateTenant', () => {
    it('changes the status and returns the updated tenant', async () => {
      const suspended = await store.updateTenant(idB, { status: 'suspended' })
      expect(suspended).toMatchObject({ id: idB, status: 'suspended', name: 'Tenant B' })

      const active = await store.updateTenant(idB, { status: 'active' })
      expect(active?.status).toBe('active')
    })

    it('changes only the fields that are given', async () => {
      const renamed = await store.updateTenant(idB, { name: 'Renamed B' })
      expect(renamed).toMatchObject({ name: 'Renamed B', status: 'active' })
    })

    it('returns null for an unknown tenant', async () => {
      expect(await store.updateTenant(`${prefix}_missing`, { status: 'suspended' })).toBeNull()
    })
  })

  describe('markTenantDeleting', () => {
    it('marks the tenant as deleting, and updateTenant can then no longer change it', async () => {
      const id = `${prefix}_deleting`
      await store.createTenant(id, 'Being deleted')

      expect(await store.markTenantDeleting(id)).toBe(true)
      expect((await store.getTenant(id))?.status).toBe('deleting')

      // A reactivation (or rename) racing with a delete must not win
      expect(await store.updateTenant(id, { status: 'active' })).toBeNull()
      expect(await store.updateTenant(id, { name: 'Renamed' })).toBeNull()
      expect(await store.getTenant(id)).toMatchObject({ status: 'deleting', name: 'Being deleted' })

      // Marking again (a retried delete) is fine
      expect(await store.markTenantDeleting(id)).toBe(true)
    })

    it('returns false for an unknown tenant', async () => {
      expect(await store.markTenantDeleting(`${prefix}_missing`)).toBe(false)
    })
  })

  describe('deleteTenantAndKeys', () => {
    it('removes the tenant together with all of its keys (revoked or not)', async () => {
      const id = `${prefix}_gone`
      await store.createTenant(id, 'To delete')
      const revoked = await store.createApiKey(id, 'old')
      await store.revokeApiKey(id, revoked.key.id)
      await store.createApiKey(id, 'live')

      expect(await store.deleteTenantAndKeys(id)).toBe(true)

      expect(await store.getTenant(id)).toBeNull()
      const keys = await sql`SELECT 1 FROM public.api_keys WHERE tenant_id = ${id}`
      expect(keys).toHaveLength(0)
    })

    it("does not touch another tenant's keys and returns false for an unknown tenant", async () => {
      const before = (await store.listApiKeys(idA)).length
      expect(await store.deleteTenantAndKeys(`${prefix}_missing`)).toBe(false)
      expect((await store.listApiKeys(idA)).length).toBe(before)
    })
  })
})
