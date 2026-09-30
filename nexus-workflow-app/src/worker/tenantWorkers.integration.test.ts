import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { parseBpmn, execute, type ServiceTaskHandler, type TaskContext } from 'nexus-workflow-core'
import { PostgresStateStore } from '../db/PostgresStateStore.js'
import { runMigrations } from '../db/migrate.js'
import { provisionTenantSchema, dropTenantSchema } from '../db/tenantProvisioner.js'
import { computeStoreOps } from '../http/engineHelpers.js'
import { TenantEventHub } from '../events/TenantEventHub.js'
import { TenantWorkerManager } from './TenantWorkerManager.js'
import { createTenantWorkers } from './createTenantWorkers.js'

// End to end: real tenant schemas, real per-tenant workers, one shared event hub.
// A service task started in one tenant must be run by that tenant's worker and complete
// in that tenant's schema.

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgres://nexus:nexus@localhost:5433/nexus_workflow'

const SERVICE_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:nexus="http://nexus-workflow/extensions"
             targetNamespace="http://example.com">
  <process id="svc-proc" name="Service Task Process" isExecutable="true">
    <startEvent id="start-1"><outgoing>f1</outgoing></startEvent>
    <serviceTask id="svc-1" name="Record" nexus:type="record">
      <incoming>f1</incoming><outgoing>f2</outgoing>
    </serviceTask>
    <endEvent id="end-1"><incoming>f2</incoming></endEvent>
    <sequenceFlow id="f1" sourceRef="start-1" targetRef="svc-1"/>
    <sequenceFlow id="f2" sourceRef="svc-1" targetRef="end-1"/>
  </process>
</definitions>`

async function waitFor<T>(fn: () => Promise<T | undefined | false>, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() > deadline) throw new Error('timed out waiting for condition')
    await new Promise(r => setTimeout(r, 25))
  }
}

describe('per-tenant workers (integration)', () => {
  const tenants = ['wk_a', 'wk_b']
  const handled: string[] = []
  const handler: ServiceTaskHandler = {
    taskType: 'record',
    async execute(ctx: TaskContext) {
      handled.push(ctx.instanceId)
      return { status: 'completed' }
    },
  }

  let admin: postgres.Sql
  let hub: TenantEventHub
  let manager: TenantWorkerManager
  const stores = new Map<string, PostgresStateStore>()

  beforeAll(async () => {
    await runMigrations(DATABASE_URL)
    admin = postgres(DATABASE_URL)
    for (const t of tenants) {
      await provisionTenantSchema(t, admin)
      stores.set(t, new PostgresStateStore(DATABASE_URL, t))
    }
    hub = new TenantEventHub()
    manager = new TenantWorkerManager({
      listActiveTenantIds: async () => [tenants[0]!],
      createWorkers: (tenantId) => createTenantWorkers(tenantId, {
        databaseUrl: DATABASE_URL,
        eventBusFor: (id) => hub.busFor(id),
        handlers: [handler],
        schedulerPollIntervalMs: 100,
      }),
      pollIntervalMs: 60_000,
    })
    await manager.start() // only wk_a is "active" at startup
  })

  afterAll(async () => {
    await manager.stop()
    for (const store of stores.values()) await store.end()
    for (const t of tenants) await dropTenantSchema(t, admin)
    await admin.end()
  })

  async function startInstance(tenantId: string): Promise<string> {
    const store = stores.get(tenantId)!
    const { definition } = parseBpmn(SERVICE_TASK_BPMN)
    await store.saveDefinition(definition!)
    const result = execute(definition!, { type: 'StartProcess' }, null)
    await store.executeTransaction(computeStoreOps(true, [], result.newState))
    await hub.busFor(tenantId).publishMany(result.events)
    return result.newState.instance.id
  }

  const status = async (tenantId: string, instanceId: string) =>
    (await stores.get(tenantId)!.getInstance(instanceId))?.status

  it("runs a tenant's service task with that tenant's worker and completes it in the tenant schema", async () => {
    const instanceId = await startInstance('wk_a')

    await waitFor(async () => (await status('wk_a', instanceId)) === 'completed')

    expect(handled.filter(id => id === instanceId)).toHaveLength(1)
  })

  it('does not run a tenant\'s tasks until that tenant has workers, then runs them once ensure() is called', async () => {
    expect(manager.activeTenants()).toEqual(['wk_a'])
    const stuck = await startInstance('wk_b')
    await new Promise(r => setTimeout(r, 300))
    expect(await status('wk_b', stuck)).toBe('active') // no worker yet: event was not handled

    await manager.ensure('wk_b')
    const instanceId = await startInstance('wk_b')

    await waitFor(async () => (await status('wk_b', instanceId)) === 'completed')
    expect(handled.filter(id => id === instanceId)).toHaveLength(1)
  })
})
