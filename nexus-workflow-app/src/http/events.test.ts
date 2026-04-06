import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { parseBpmn, InMemoryStateStore, InMemoryEventBus, execute } from 'nexus-workflow-core'
import * as coreModule from 'nexus-workflow-core'
import { createEventsRouter } from './events.js'
import { computeStoreOps } from './engineHelpers.js'

vi.mock('nexus-workflow-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nexus-workflow-core')>()
  return { ...actual, execute: vi.fn(actual.execute) }
})

// ─── BPMN Fixtures ────────────────────────────────────────────────────────────

const MESSAGE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  id="Definitions_7" targetNamespace="http://nexus-workflow/schema">
  <bpmn:process id="proc_message" name="Intermediate Message" isExecutable="true">
    <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:intermediateCatchEvent id="msg_catch" name="Wait for Order Shipped">
      <bpmn:incoming>flow_1</bpmn:incoming>
      <bpmn:outgoing>flow_2</bpmn:outgoing>
      <bpmn:messageEventDefinition messageRef="OrderShipped"/>
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="end_1"><bpmn:incoming>flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="msg_catch"/>
    <bpmn:sequenceFlow id="flow_2" sourceRef="msg_catch" targetRef="end_1"/>
  </bpmn:process>
</bpmn:definitions>`

const SIGNAL_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  id="Definitions_8" targetNamespace="http://nexus-workflow/schema">
  <bpmn:process id="proc_signal" name="Intermediate Signal" isExecutable="true">
    <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:intermediateCatchEvent id="sig_catch" name="Wait for Emergency Stop">
      <bpmn:incoming>flow_1</bpmn:incoming>
      <bpmn:outgoing>flow_2</bpmn:outgoing>
      <bpmn:signalEventDefinition signalRef="EmergencyStop"/>
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="end_1"><bpmn:incoming>flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="sig_catch"/>
    <bpmn:sequenceFlow id="flow_2" sourceRef="sig_catch" targetRef="end_1"/>
  </bpmn:process>
</bpmn:definitions>`

// ─── Fixture Helpers ──────────────────────────────────────────────────────────

async function seedAndStart(
  store: InMemoryStateStore,
  bpmnXml: string,
): Promise<{ instanceId: string }> {
  const { definition: def } = parseBpmn(bpmnXml)
  await store.saveDefinition(def!)
  const { newState } = execute(def!, { type: 'StartProcess' }, null)
  // computeStoreOps now includes subscription ops derived from token waitingFor state
  await store.executeTransaction(computeStoreOps(true, null, newState))
  return { instanceId: newState.instance.id }
}

async function post(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('events HTTP API', () => {
  let store: InMemoryStateStore
  let eventBus: InMemoryEventBus
  let app: Hono

  beforeEach(() => {
    store = new InMemoryStateStore()
    eventBus = new InMemoryEventBus()
    app = new Hono()
    app.route('/', createEventsRouter(() => store, eventBus))
  })

  // ─── Messages ───────────────────────────────────────────────────────────────

  describe('POST /messages', () => {
    it('delivers a message and advances the waiting instance', async () => {
      const { instanceId } = await seedAndStart(store, MESSAGE_BPMN)

      const res = await post(app, '/messages', { messageName: 'OrderShipped' })

      expect(res.status).toBe(200)
      const body = await res.json() as { instance: { status: string }; events: string[] }
      expect(body.instance.status).toBe('completed')
      expect(body.events).toContain('ProcessInstanceCompleted')

      const persisted = await store.getInstance(instanceId)
      expect(persisted?.status).toBe('completed')
    })

    it('returns 404 when no subscription matches', async () => {
      const res = await post(app, '/messages', { messageName: 'UnknownMessage' })
      expect(res.status).toBe(404)
    })

    it('returns 400 when messageName is missing', async () => {
      const res = await post(app, '/messages', {})
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('400: missing messageName returns VALIDATION_ERROR', async () => {
      const res = await post(app, '/messages', {})
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('400: messageName as empty string returns VALIDATION_ERROR', async () => {
      const res = await post(app, '/messages', { messageName: '' })
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('returns 400 for non-JSON body', async () => {
      const res = await app.fetch(
        new Request('http://localhost/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        }),
      )
      expect(res.status).toBe(400)
    })

    it('publishes events to the event bus', async () => {
      await seedAndStart(store, MESSAGE_BPMN)
      const published: string[] = []
      eventBus.subscribe(ev => { published.push(ev.type) })

      await post(app, '/messages', { messageName: 'OrderShipped' })

      expect(published.length).toBeGreaterThan(0)
    })

    it('returns 500 when instance state not found after subscription lookup', async () => {
      // Seed a subscription pointing to a non-existent instance
      // This simulates a stale subscription (instance was deleted externally)
      await store.executeTransaction([{
        op: 'saveSubscription',
        subscription: {
          id: 'orphan-sub',
          instanceId: 'non-existent-instance',
          tokenId: 'tok-orphan',
          type: 'message',
          messageName: 'OrphanMessage',
          status: 'active',
          createdAt: new Date(),
        },
      }])

      const res = await post(app, '/messages', { messageName: 'OrphanMessage' })
      expect(res.status).toBe(500)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('INTERNAL_ERROR')
    })

    it('returns 400 when correlationValue is not a string', async () => {
      const res = await post(app, '/messages', { messageName: 'OrderShipped', correlationValue: 42 })
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when body is an array', async () => {
      const res = await app.fetch(
        new Request('http://localhost/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{ messageName: 'OrderShipped' }]),
        }),
      )
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('returns 422 when execute throws RuntimeError', async () => {
      await seedAndStart(store, MESSAGE_BPMN)

      vi.mocked(coreModule.execute).mockImplementationOnce(() => { throw new coreModule.RuntimeError('forced') })

      const res = await post(app, '/messages', { messageName: 'OrderShipped' })
      expect(res.status).toBe(422)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('RUNTIME_ERROR')
    })
  })

  // ─── Signals ────────────────────────────────────────────────────────────────

  describe('POST /signals', () => {
    it('broadcasts a signal and advances the waiting instance', async () => {
      const { instanceId } = await seedAndStart(store, SIGNAL_BPMN)

      const res = await post(app, '/signals', { signalName: 'EmergencyStop' })

      expect(res.status).toBe(200)
      const body = await res.json() as { delivered: number; results: Array<{ instanceId: string }> }
      expect(body.delivered).toBe(1)
      expect(body.results[0]!.instanceId).toBe(instanceId)

      const persisted = await store.getInstance(instanceId)
      expect(persisted?.status).toBe('completed')
    })

    it('broadcasts to multiple instances', async () => {
      await seedAndStart(store, SIGNAL_BPMN)
      await seedAndStart(store, SIGNAL_BPMN)

      const res = await post(app, '/signals', { signalName: 'EmergencyStop' })

      expect(res.status).toBe(200)
      const body = await res.json() as { delivered: number }
      expect(body.delivered).toBe(2)
    })

    it('returns delivered: 0 when no instances are subscribed', async () => {
      const res = await post(app, '/signals', { signalName: 'NonExistentSignal' })

      expect(res.status).toBe(200)
      const body = await res.json() as { delivered: number; results: unknown[] }
      expect(body.delivered).toBe(0)
      expect(body.results).toEqual([])
    })

    it('returns 400 when signalName is missing', async () => {
      const res = await post(app, '/signals', {})
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('400: missing signalName returns VALIDATION_ERROR', async () => {
      const res = await post(app, '/signals', {})
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('returns 400 for non-JSON body', async () => {
      const res = await app.fetch(
        new Request('http://localhost/signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-json',
        }),
      )
      expect(res.status).toBe(400)
    })

    it('returns 400 when body is an array', async () => {
      const res = await app.fetch(
        new Request('http://localhost/signals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify([{ signalName: 'EmergencyStop' }]),
        }),
      )
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('skips the subscription when execute throws and continues with remaining', async () => {
      await seedAndStart(store, SIGNAL_BPMN)

      vi.mocked(coreModule.execute).mockImplementationOnce(() => { throw new Error('unexpected engine error') })

      const res = await post(app, '/signals', { signalName: 'EmergencyStop' })
      expect(res.status).toBe(200)
      const body = await res.json() as { delivered: number }
      expect(body.delivered).toBe(0)
    })

    it('skips instances where execution throws (RuntimeError) and continues with others', async () => {
      // Seed a stale subscription pointing to a non-existent instance.
      // The coordinator will try to load it, get no state (loadEngineState returns null),
      // and skip it. This exercises the "if (!state) continue" path.
      await store.executeTransaction([{
        op: 'saveSubscription',
        subscription: {
          id: 'stale-signal-sub',
          instanceId: 'non-existent-instance-for-signal',
          tokenId: 'tok-stale',
          type: 'signal',
          signalName: 'EmergencyStop',
          status: 'active',
          createdAt: new Date(),
        },
      }])

      // Also seed a real instance waiting for the signal
      const { instanceId } = await seedAndStart(store, SIGNAL_BPMN)

      const res = await post(app, '/signals', { signalName: 'EmergencyStop' })

      expect(res.status).toBe(200)
      const body = await res.json() as { delivered: number }
      // Only the real instance should count as delivered (stale is skipped)
      expect(body.delivered).toBe(1)

      const instance = await store.getInstance(instanceId)
      expect(instance?.status).toBe('completed')
    })
  })
})
