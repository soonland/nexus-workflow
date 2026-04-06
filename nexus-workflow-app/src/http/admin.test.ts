import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { parseBpmn, InMemoryStateStore, InMemoryEventBus, execute } from 'nexus-workflow-core'
import * as coreModule from 'nexus-workflow-core'
import { createAdminRouter } from './admin.js'
import { computeStoreOps } from './engineHelpers.js'

vi.mock('nexus-workflow-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nexus-workflow-core')>()
  return { ...actual, execute: vi.fn(actual.execute) }
})

// ─── BPMN Fixtures ────────────────────────────────────────────────────────────

// A simple process that pauses at a service task (waiting)
const SERVICE_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.com">
  <process id="svc-proc" name="Service Task Process" isExecutable="true">
    <startEvent id="start-1"><outgoing>flow-1</outgoing></startEvent>
    <serviceTask id="task-1" name="Do Work"><incoming>flow-1</incoming><outgoing>flow-2</outgoing></serviceTask>
    <endEvent id="end-1"><incoming>flow-2</incoming></endEvent>
    <sequenceFlow id="flow-1" sourceRef="start-1" targetRef="task-1"/>
    <sequenceFlow id="flow-2" sourceRef="task-1" targetRef="end-1"/>
  </process>
</definitions>`

// ─── Fixture Helpers ──────────────────────────────────────────────────────────

async function loadState(store: InMemoryStateStore, instanceId: string) {
  const instance = await store.getInstance(instanceId)
  if (!instance) return null
  const tokens = await store.getAllTokens(instanceId)
  const gatewayJoinStates = await store.listGatewayStates(instanceId)
  const scopeIds = new Set<string>([instance.rootScopeId, ...tokens.map((t) => t.scopeId)])
  const scopes = []
  for (const id of scopeIds) {
    const scope = await store.getScope(id)
    if (scope) scopes.push(scope)
  }
  return { instance, tokens, scopes, gatewayJoinStates }
}

async function seedAndStart(
  store: InMemoryStateStore,
  bpmnXml: string,
): Promise<{ instanceId: string }> {
  const { definition: def } = parseBpmn(bpmnXml)
  await store.saveDefinition(def!)
  const { newState } = execute(def!, { type: 'StartProcess' }, null)
  await store.executeTransaction(computeStoreOps(true, null, newState))
  return { instanceId: newState.instance.id }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('admin HTTP API', () => {
  let store: InMemoryStateStore
  let eventBus: InMemoryEventBus
  let app: Hono

  beforeEach(() => {
    store = new InMemoryStateStore()
    eventBus = new InMemoryEventBus()
    app = new Hono()
    app.route('/', createAdminRouter(() => store, eventBus))
  })

  // ─── Suspend ────────────────────────────────────────────────────────────────

  describe('POST /instances/:id/suspend', () => {
    it('suspends an active instance', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/suspend`, { method: 'POST' }),
      )

      expect(res.status).toBe(200)
      const body = await res.json() as { instance: { status: string } }
      expect(body.instance.status).toBe('suspended')

      // Persisted correctly
      const persisted = await store.getInstance(instanceId)
      expect(persisted?.status).toBe('suspended')
    })

    it('returns 404 for unknown instance', async () => {
      const res = await app.fetch(
        new Request('http://localhost/instances/no-such-id/suspend', { method: 'POST' }),
      )
      expect(res.status).toBe(404)
    })

    it('returns 422 when instance is not active', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      // First suspend it
      await app.fetch(new Request(`http://localhost/instances/${instanceId}/suspend`, { method: 'POST' }))

      // Suspending again should fail
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/suspend`, { method: 'POST' }),
      )
      expect(res.status).toBe(422)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('INVALID_STATE')
    })

    it('publishes an event after suspending', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)
      const published: string[] = []
      eventBus.subscribe(ev => { published.push(ev.type) })

      await app.fetch(new Request(`http://localhost/instances/${instanceId}/suspend`, { method: 'POST' }))

      expect(published).toContain('ProcessInstanceSuspended')
    })

    it('returns 422 when execute throws RuntimeError', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      vi.mocked(coreModule.execute).mockImplementationOnce(() => { throw new coreModule.RuntimeError('forced') })

      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/suspend`, { method: 'POST' }),
      )
      expect(res.status).toBe(422)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('RUNTIME_ERROR')
    })
  })

  // ─── Resume ─────────────────────────────────────────────────────────────────

  describe('POST /instances/:id/resume', () => {
    it('resumes a suspended instance', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      // Suspend first
      await app.fetch(new Request(`http://localhost/instances/${instanceId}/suspend`, { method: 'POST' }))

      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/resume`, { method: 'POST' }),
      )

      expect(res.status).toBe(200)
      const body = await res.json() as { instance: { status: string } }
      expect(body.instance.status).toBe('active')

      const persisted = await store.getInstance(instanceId)
      expect(persisted?.status).toBe('active')
    })

    it('returns 404 for unknown instance', async () => {
      const res = await app.fetch(
        new Request('http://localhost/instances/no-such-id/resume', { method: 'POST' }),
      )
      expect(res.status).toBe(404)
    })

    it('returns 422 when instance is not suspended', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      // Instance is active, not suspended
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/resume`, { method: 'POST' }),
      )
      expect(res.status).toBe(422)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('INVALID_STATE')
    })

    it('publishes an event after resuming', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)
      await app.fetch(new Request(`http://localhost/instances/${instanceId}/suspend`, { method: 'POST' }))

      const published: string[] = []
      eventBus.subscribe(ev => { published.push(ev.type) })

      await app.fetch(new Request(`http://localhost/instances/${instanceId}/resume`, { method: 'POST' }))

      expect(published).toContain('ProcessInstanceResumed')
    })

    it('returns 422 when execute throws RuntimeError', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)
      await app.fetch(new Request(`http://localhost/instances/${instanceId}/suspend`, { method: 'POST' }))

      vi.mocked(coreModule.execute).mockImplementationOnce(() => { throw new coreModule.RuntimeError('forced') })

      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/resume`, { method: 'POST' }),
      )
      expect(res.status).toBe(422)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('RUNTIME_ERROR')
    })
  })

  // ─── Restart ────────────────────────────────────────────────────────────────

  describe('POST /instances/:id/restart', () => {
    it('restarts a terminated instance and returns 201 with new instance + tokens', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      // Cancel the instance to get it to terminated state
      const { definition: def } = parseBpmn(SERVICE_TASK_BPMN)
      const state = await loadState(store, instanceId)
      const cancelResult = execute(def!, { type: 'CancelInstance' }, state!)
      await store.executeTransaction(computeStoreOps(false, state!, cancelResult.newState))

      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/restart`, { method: 'POST' }),
      )

      expect(res.status).toBe(201)
      const body = await res.json() as { instance: { status: string }; tokens: unknown[]; restartedFromId: string }
      expect(body).toHaveProperty('instance')
      expect(body).toHaveProperty('tokens')
      expect(body.restartedFromId).toBe(instanceId)
    })

    it('returns 404 for unknown instance', async () => {
      const res = await app.fetch(
        new Request('http://localhost/instances/no-such-id/restart', { method: 'POST' }),
      )
      expect(res.status).toBe(404)
    })

    it('returns 422 when instance is not terminated', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      // Instance is active (waiting on service task), not terminated
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/restart`, { method: 'POST' }),
      )
      expect(res.status).toBe(422)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('INVALID_STATE')
    })

    it('publishes ProcessInstanceRestarted event after restart', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      const { definition: def } = parseBpmn(SERVICE_TASK_BPMN)
      const state = await loadState(store, instanceId)
      const cancelResult = execute(def!, { type: 'CancelInstance' }, state!)
      await store.executeTransaction(computeStoreOps(false, state!, cancelResult.newState))

      const published: string[] = []
      eventBus.subscribe(ev => { published.push(ev.type) })

      await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/restart`, { method: 'POST' }),
      )

      expect(published).toContain('ProcessInstanceRestarted')
    })

    it('returns 422 when execute throws RuntimeError', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)
      const { definition: def } = parseBpmn(SERVICE_TASK_BPMN)
      const state = await loadState(store, instanceId)
      const cancelResult = execute(def!, { type: 'CancelInstance' }, state!)
      await store.executeTransaction(computeStoreOps(false, state!, cancelResult.newState))

      vi.mocked(coreModule.execute).mockImplementationOnce(() => { throw new coreModule.RuntimeError('forced') })

      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/restart`, { method: 'POST' }),
      )
      expect(res.status).toBe(422)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('RUNTIME_ERROR')
    })

    it('new instance created by restart is stored in the store', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      const { definition: def } = parseBpmn(SERVICE_TASK_BPMN)
      const state = await loadState(store, instanceId)
      const cancelResult = execute(def!, { type: 'CancelInstance' }, state!)
      await store.executeTransaction(computeStoreOps(false, state!, cancelResult.newState))

      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/restart`, { method: 'POST' }),
      )
      const body = await res.json() as { instance: { id: string } }
      const newId = body.instance.id
      expect(newId).not.toBe(instanceId)

      const stored = await store.getInstance(newId)
      expect(stored).not.toBeNull()
    })
  })

  // ─── History ────────────────────────────────────────────────────────────────

  describe('GET /instances/:id/history', () => {
    it('returns empty history for a fresh instance', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/history`),
      )

      expect(res.status).toBe(200)
      const body = await res.json() as { history: unknown[] }
      expect(Array.isArray(body.history)).toBe(true)
    })

    it('returns 404 for unknown instance', async () => {
      const res = await app.fetch(
        new Request('http://localhost/instances/no-such-id/history'),
      )
      expect(res.status).toBe(404)
    })

    it('returns history entries that were appended', async () => {
      const { instanceId } = await seedAndStart(store, SERVICE_TASK_BPMN)

      // Directly append a history entry (history population is a concern of the
      // app's event handlers, not the HTTP layer under test here)
      await store.executeTransaction([{
        op: 'appendHistory',
        entry: {
          id: 'hist-1',
          instanceId,
          tokenId: 'tok-1',
          elementId: 'task-1',
          elementType: 'serviceTask',
          status: 'completed',
          startedAt: new Date(),
          completedAt: new Date(),
        },
      }])

      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/history`),
      )

      expect(res.status).toBe(200)
      const body = await res.json() as { history: Array<{ elementId: string }> }
      expect(body.history.some(h => h.elementId === 'task-1')).toBe(true)
    })
  })
})
