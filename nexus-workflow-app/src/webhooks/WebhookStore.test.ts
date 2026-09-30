import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { InMemoryWebhookStore, PostgresWebhookStore } from './WebhookStore.js'
import { runMigrations } from '../db/migrate.js'
import { provisionTenantSchema, dropTenantSchema } from '../db/tenantProvisioner.js'

describe('InMemoryWebhookStore', () => {
  it('saves, lists and deletes registrations', async () => {
    const store = new InMemoryWebhookStore()
    const reg = await store.save({ url: 'https://example.com/hook' })

    expect(await store.list()).toEqual([reg])
    expect(await store.delete(reg.id)).toBe(true)
    expect(await store.delete(reg.id)).toBe(false)
    expect(await store.list()).toEqual([])
  })
})

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

describe('PostgresWebhookStore (per tenant)', () => {
  const tenantA = 'webhook_iso_a'
  const tenantB = 'webhook_iso_b'
  let admin: postgres.Sql
  let storeA: PostgresWebhookStore
  let storeB: PostgresWebhookStore

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    admin = postgres(DATABASE_URL)
    await provisionTenantSchema(tenantA, admin)
    await provisionTenantSchema(tenantB, admin)
    storeA = new PostgresWebhookStore(DATABASE_URL, tenantA)
    storeB = new PostgresWebhookStore(DATABASE_URL, tenantB)
  })

  afterAll(async () => {
    await storeA.end()
    await storeB.end()
    await dropTenantSchema(tenantA, admin)
    await dropTenantSchema(tenantB, admin)
    await admin.end()
  })

  it('saves and lists a registration with its events filter and secret', async () => {
    const reg = await storeA.save({ url: 'https://a.example.com/hook', events: ['ProcessInstanceCompleted'], secret: 's3cret' })

    expect(reg).toMatchObject({ url: 'https://a.example.com/hook', events: ['ProcessInstanceCompleted'], secret: 's3cret' })
    expect((await storeA.list()).map(r => r.id)).toContain(reg.id)
  })

  it("does not list another tenant's registrations", async () => {
    const regA = await storeA.save({ url: 'https://only-a.example.com/hook' })
    const regB = await storeB.save({ url: 'https://only-b.example.com/hook' })

    const idsA = (await storeA.list()).map(r => r.id)
    const idsB = (await storeB.list()).map(r => r.id)

    expect(idsA).toContain(regA.id)
    expect(idsA).not.toContain(regB.id)
    expect(idsB).toContain(regB.id)
    expect(idsB).not.toContain(regA.id)
  })

  it("cannot delete another tenant's registration", async () => {
    const regA = await storeA.save({ url: 'https://a-keep.example.com/hook' })

    expect(await storeB.delete(regA.id)).toBe(false)
    expect((await storeA.list()).map(r => r.id)).toContain(regA.id)
    expect(await storeA.delete(regA.id)).toBe(true)
  })

  it('rejects an invalid tenant id', () => {
    expect(() => new PostgresWebhookStore(DATABASE_URL, 'bad tenant!')).toThrow(/Invalid tenantId/)
  })
})
