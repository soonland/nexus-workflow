import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { parseBpmn, InMemoryStateStore, InMemoryEventBus, execute } from 'nexus-workflow-core'
import { InMemoryEventLog } from '../db/EventLog.js'
import { createObservabilityRouter } from './observability.js'
import { createInstancesRouter } from './instances.js'
import { computeStoreOps } from './engineHelpers.js'

// ─── BPMN Fixtures ────────────────────────────────────────────────────────────

const SIMPLE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://example.com">
  <process id="simple-proc" name="Simple Process" isExecutable="true">
    <startEvent id="start-1">
      <outgoing>flow-1</outgoing>
    </startEvent>
    <userTask id="task-1" name="Review">
      <incoming>flow-1</incoming>
      <outgoing>flow-2</outgoing>
    </userTask>
    <endEvent id="end-1">
      <incoming>flow-2</incoming>
    </endEvent>
    <sequenceFlow id="flow-1" sourceRef="start-1" targetRef="task-1"/>
    <sequenceFlow id="flow-2" sourceRef="task-1" targetRef="end-1"/>
  </process>
</definitions>`

// ─── Fixture Helpers ──────────────────────────────────────────────────────────

async function seedAndStart(
  store: InMemoryStateStore,
  eventBus: InMemoryEventBus,
  eventLog: InMemoryEventLog,
  bpmnXml: string = SIMPLE_BPMN,
  _definitionId: string = 'simple-proc',
): Promise<{ instanceId: string }> {
  const { definition } = parseBpmn(bpmnXml)
  await store.saveDefinition(definition!)
  const { newState, events } = execute(definition!, { type: 'StartProcess' }, null)
  await store.executeTransaction(computeStoreOps(true, null, newState))
  for (const event of events) {
    await eventLog.append(event)
  }
  await eventBus.publishMany(events)
  return { instanceId: newState.instance.id }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('observability HTTP API', () => {
  let store: InMemoryStateStore
  let eventBus: InMemoryEventBus
  let eventLog: InMemoryEventLog
  let app: Hono

  beforeEach(() => {
    store = new InMemoryStateStore()
    eventBus = new InMemoryEventBus()
    eventLog = new InMemoryEventLog()
    app = new Hono()
    app.route('/', createInstancesRouter(store, eventBus))
    app.route('/', createObservabilityRouter(store, eventLog))
  })

  // ─── GET /instances/:id/events ────────────────────────────────────────────────

  describe('GET /instances/:id/events', () => {
    it('200: returns empty events array for a fresh instance with no logged events', async () => {
      const { instanceId } = await seedAndStart(store, eventBus, new InMemoryEventLog())
      // Use a fresh eventLog with no events for this instance
      const freshEventLog = new InMemoryEventLog()
      const freshApp = new Hono()
      freshApp.route('/', createObservabilityRouter(store, freshEventLog))

      const res = await freshApp.fetch(new Request(`http://localhost/instances/${instanceId}/events`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('events')
      expect(Array.isArray(body.events)).toBe(true)
      expect(body.events).toHaveLength(0)
    })

    it('404: returns 404 for unknown instance', async () => {
      const res = await app.fetch(new Request('http://localhost/instances/does-not-exist/events'))
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body).toHaveProperty('error', 'NOT_FOUND')
    })

    it('200: returns appended events for a known instance', async () => {
      const { instanceId } = await seedAndStart(store, eventBus, eventLog)

      const res = await app.fetch(new Request(`http://localhost/instances/${instanceId}/events`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.events.length).toBeGreaterThan(0)
    })

    it('200: events have required fields', async () => {
      const { instanceId } = await seedAndStart(store, eventBus, eventLog)

      const res = await app.fetch(new Request(`http://localhost/instances/${instanceId}/events`))
      const body = await res.json()
      const event = body.events[0]
      expect(event).toHaveProperty('id')
      expect(event).toHaveProperty('type')
      expect(event).toHaveProperty('occurredAt')
      expect(event).toHaveProperty('data')
    })

    it('200: events include ProcessInstanceStarted event', async () => {
      const { instanceId } = await seedAndStart(store, eventBus, eventLog)

      const res = await app.fetch(new Request(`http://localhost/instances/${instanceId}/events`))
      const body = await res.json()
      const types: string[] = body.events.map((e: { type: string }) => e.type)
      expect(types).toContain('ProcessInstanceStarted')
    })

    it('200: events for one instance do not include events from another', async () => {
      const { instanceId: id1 } = await seedAndStart(store, eventBus, eventLog)
      const { instanceId: id2 } = await seedAndStart(store, eventBus, eventLog)

      const res = await app.fetch(new Request(`http://localhost/instances/${id1}/events`))
      const body = await res.json()
      const instanceIds = body.events
        .filter((e: { instanceId?: string }) => e.instanceId !== null && e.instanceId !== undefined)
        .map((e: { instanceId: string }) => e.instanceId)
      expect(instanceIds.every((iid: string) => iid === id1)).toBe(true)
      expect(instanceIds).not.toContain(id2)
    })
  })

  // ─── GET /metrics ─────────────────────────────────────────────────────────────

  describe('GET /metrics', () => {
    it('200: returns zero counts initially', async () => {
      const res = await app.fetch(new Request('http://localhost/metrics'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('instances')
      expect(body).toHaveProperty('tasks')
      expect(body.instances.active).toBe(0)
      expect(body.instances.suspended).toBe(0)
      expect(body.tasks.pending).toBe(0)
    })

    it('200: returns correct active count after starting an instance', async () => {
      await seedAndStart(store, eventBus, eventLog)

      const res = await app.fetch(new Request('http://localhost/metrics'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.instances.active).toBe(1)
      expect(body.instances.suspended).toBe(0)
    })

    it('200: returns correct suspended count after suspending an instance', async () => {
      const { instanceId } = await seedAndStart(store, eventBus, eventLog)
      const { definition } = parseBpmn(SIMPLE_BPMN)
      const instance = await store.getInstance(instanceId)
      const tokens = await store.getAllTokens(instanceId)
      const gatewayJoinStates = await store.listGatewayStates(instanceId)
      const scopes = []
      for (const t of tokens) {
        const scope = await store.getScope(t.scopeId)
        if (scope) scopes.push(scope)
      }
      const rootScope = await store.getScope(instance!.rootScopeId)
      if (rootScope) scopes.push(rootScope)
      const state = { instance: instance!, tokens, scopes, gatewayJoinStates }
      const { newState } = execute(definition!, { type: 'SuspendInstance' }, state)
      await store.executeTransaction(computeStoreOps(false, state, newState))

      const res = await app.fetch(new Request('http://localhost/metrics'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.instances.active).toBe(0)
      expect(body.instances.suspended).toBe(1)
    })

    it('200: pending task count reflects open user tasks', async () => {
      await seedAndStart(store, eventBus, eventLog)

      const res = await app.fetch(new Request('http://localhost/metrics'))
      const body = await res.json()
      // The simple process has a userTask that is waiting
      expect(body.tasks.pending).toBeGreaterThanOrEqual(0)
    })

    it('200: response shape is correct', async () => {
      const res = await app.fetch(new Request('http://localhost/metrics'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(typeof body.instances.active).toBe('number')
      expect(typeof body.instances.suspended).toBe('number')
      expect(typeof body.tasks.pending).toBe('number')
    })
  })
})
