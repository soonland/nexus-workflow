import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { parseBpmn, InMemoryStateStore, InMemoryEventBus ,type  ProcessDefinition,type  Token,type  ExecutionEvent } from 'nexus-workflow-core'
import { createInstancesRouter } from './instances.js'

// ─── BPMN Fixtures ────────────────────────────────────────────────────────────

const SIMPLE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://example.com">
  <process id="simple-proc" name="Simple Process" isExecutable="true">
    <startEvent id="start-1">
      <outgoing>flow-1</outgoing>
    </startEvent>
    <endEvent id="end-1">
      <incoming>flow-1</incoming>
    </endEvent>
    <sequenceFlow id="flow-1" sourceRef="start-1" targetRef="end-1"/>
  </process>
</definitions>`

const USER_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://example.com">
  <process id="usertask-proc" name="User Task Process" isExecutable="true">
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

async function seedDefinition(
  store: InMemoryStateStore,
  bpmnXml: string,
): Promise<ProcessDefinition> {
  const { definition } = parseBpmn(bpmnXml)
  await store.saveDefinition(definition!)
  return definition!
}

async function startInstance(
  app: Hono,
  definitionId: string,
  body: Record<string, unknown> = {},
): Promise<{ instance: Record<string, unknown>; tokens: Token[] }> {
  const res = await app.fetch(
    new Request(`http://localhost/definitions/${definitionId}/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return res.json()
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('instances HTTP API', () => {
  let store: InMemoryStateStore
  let eventBus: InMemoryEventBus
  let app: Hono

  beforeEach(() => {
    store = new InMemoryStateStore()
    eventBus = new InMemoryEventBus()
    app = new Hono()
    app.route('/', createInstancesRouter(store, eventBus))
  })

  // ─── POST /definitions/:definitionId/instances ───────────────────────────────

  describe('POST /definitions/:definitionId/instances', () => {
    it('201: simple process starts and completes immediately', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.instance.status).toBe('completed')
    })

    it('201: response includes instance and tokens fields', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body).toHaveProperty('instance')
      expect(body).toHaveProperty('tokens')
      expect(Array.isArray(body.tokens)).toBe(true)
    })

    it('201: instance is persisted in the store after response', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(201)
      const { instance } = await res.json()
      const stored = await store.getInstance(instance.id)
      expect(stored).not.toBeNull()
      expect(stored!.id).toBe(instance.id)
    })

    it('201: with variables body — variables are set on the root scope', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: { x: { type: 'number', value: 42 } } }),
        }),
      )
      expect(res.status).toBe(201)
      const { instance } = await res.json()
      const scope = await store.getScope(instance.rootScopeId)
      expect(scope).not.toBeNull()
      expect(scope!.variables).toHaveProperty('x')
      expect(scope!.variables['x']!.value).toBe(42)
    })

    it('201: with correlationKey in body — appears on instance', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ correlationKey: 'order-123' }),
        }),
      )
      expect(res.status).toBe(201)
      const { instance } = await res.json()
      expect(instance.correlationKey).toBe('order-123')
    })

    it('201: with businessKey in body — appears on instance', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessKey: 'BIZ-456' }),
        }),
      )
      expect(res.status).toBe(201)
      const { instance } = await res.json()
      expect(instance.businessKey).toBe('BIZ-456')
    })

    it('201: user task process starts and pauses (status = active, has a waiting token)', async () => {
      await seedDefinition(store, USER_TASK_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/usertask-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.instance.status).toBe('active')
      const waitingToken = body.tokens.find((t: Token) => t.status === 'waiting')
      expect(waitingToken).toBeDefined()
    })

    it('404: unknown definitionId returns 404', async () => {
      const res = await app.fetch(
        new Request('http://localhost/definitions/does-not-exist/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(404)
    })

    it('422: non-deployable definition returns 422', async () => {
      const def = await seedDefinition(store, SIMPLE_BPMN)
      // Overwrite with isDeployable: false
      await store.saveDefinition({ ...def, isDeployable: false })
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(422)
    })

    it('400: non-JSON content-type body returns 400', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not-valid-json',
        }),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('400: variables value as an array returns 400', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: [1, 2, 3] }),
        }),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('400: correlationKey that is not a string returns 400', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ correlationKey: 42 }),
        }),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('400: businessKey that is not a string returns 400', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const res = await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessKey: true }),
        }),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('events: ProcessInstanceStarted event is published to the event bus', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const emitted: ExecutionEvent[] = []
      eventBus.subscribe(e => {
        emitted.push(e)
      })
      await app.fetch(
        new Request('http://localhost/definitions/simple-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(emitted.some(e => e.type === 'ProcessInstanceStarted')).toBe(true)
    })
  })

  // ─── GET /instances/:id ───────────────────────────────────────────────────────

  describe('GET /instances/:id', () => {
    it('200: returns instance, tokens, variables after start', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const { instance } = await startInstance(app, 'simple-proc')
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instance.id}`),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('instance')
      expect(body).toHaveProperty('tokens')
      expect(body).toHaveProperty('variables')
      expect(body.instance.id).toBe(instance.id)
    })

    it('200: variables reflects variables passed at start', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      const { instance } = await startInstance(app, 'simple-proc', {
        variables: { x: { type: 'number', value: 42 } },
      })
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instance.id}`),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.variables).toHaveProperty('x')
      expect(body.variables.x).toBe(42)
    })

    it('404: unknown id returns 404', async () => {
      const res = await app.fetch(
        new Request('http://localhost/instances/does-not-exist'),
      )
      expect(res.status).toBe(404)
    })
  })

  // ─── GET /instances — validation ─────────────────────────────────────────────

  describe('GET /instances — validation', () => {
    it('400: invalid status value returns VALIDATION_ERROR', async () => {
      const res = await app.fetch(
        new Request('http://localhost/instances?status=notavalidstatus'),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('400: non-numeric page returns VALIDATION_ERROR', async () => {
      const res = await app.fetch(
        new Request('http://localhost/instances?page=abc'),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('400: non-numeric pageSize returns VALIDATION_ERROR', async () => {
      const res = await app.fetch(
        new Request('http://localhost/instances?pageSize=abc'),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('VALIDATION_ERROR')
    })
  })

  // ─── GET /instances ───────────────────────────────────────────────────────────

  describe('GET /instances', () => {
    it('200: empty items array when no instances', async () => {
      const res = await app.fetch(new Request('http://localhost/instances'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('items')
      expect(Array.isArray(body.items)).toBe(true)
      expect(body.items).toHaveLength(0)
    })

    it('200: returns started instance in items', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      await startInstance(app, 'simple-proc')
      const res = await app.fetch(new Request('http://localhost/instances'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items).toHaveLength(1)
      expect(body.total).toBe(1)
    })

    it('200: filters by ?status=completed — only completed instances', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      await seedDefinition(store, USER_TASK_BPMN)
      // simple-proc completes immediately
      await startInstance(app, 'simple-proc')
      // usertask-proc stays active
      await startInstance(app, 'usertask-proc')

      const res = await app.fetch(
        new Request('http://localhost/instances?status=completed'),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items.every((i: { status: string }) => i.status === 'completed')).toBe(true)
      expect(body.items.length).toBeGreaterThanOrEqual(1)
    })

    it('200: filters by ?status=active — only active instances', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      await seedDefinition(store, USER_TASK_BPMN)
      // simple-proc completes immediately
      await startInstance(app, 'simple-proc')
      // usertask-proc stays active
      await startInstance(app, 'usertask-proc')

      const res = await app.fetch(
        new Request('http://localhost/instances?status=active'),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items.every((i: { status: string }) => i.status === 'active')).toBe(true)
      expect(body.items.length).toBeGreaterThanOrEqual(1)
    })

    it('200: filters by ?definitionId=simple-proc — only matching definition', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      await seedDefinition(store, USER_TASK_BPMN)
      await startInstance(app, 'simple-proc')
      await startInstance(app, 'usertask-proc')

      const res = await app.fetch(
        new Request('http://localhost/instances?definitionId=simple-proc'),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items.every((i: { definitionId: string }) => i.definitionId === 'simple-proc')).toBe(true)
      expect(body.items).toHaveLength(1)
    })

    it('200: pagination — ?page=0&pageSize=1 with 2 instances returns 1 item and total=2', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      await startInstance(app, 'simple-proc')
      await startInstance(app, 'simple-proc')

      const res = await app.fetch(
        new Request('http://localhost/instances?page=0&pageSize=1'),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items).toHaveLength(1)
      expect(body.total).toBe(2)
      expect(body.page).toBe(0)
      expect(body.pageSize).toBe(1)
    })
  })

  // ─── POST /instances/:id/commands ────────────────────────────────────────────

  describe('POST /instances/:id/commands', () => {
    async function startUserTaskInstance(): Promise<{
      instanceId: string
      waitingTokenId: string
    }> {
      await seedDefinition(store, USER_TASK_BPMN)
      const startRes = await app.fetch(
        new Request('http://localhost/definitions/usertask-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      const { instance, tokens } = await startRes.json()
      const waitingToken = tokens.find((t: Token) => t.status === 'waiting')
      return { instanceId: instance.id, waitingTokenId: waitingToken.id }
    }

    it('200: CompleteUserTask on a waiting token — instance becomes completed', async () => {
      const { instanceId, waitingTokenId } = await startUserTaskInstance()
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'CompleteUserTask',
            tokenId: waitingTokenId,
            completedBy: 'user-1',
          }),
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.instance.status).toBe('completed')
    })

    it('200: response includes instance and events array', async () => {
      const { instanceId, waitingTokenId } = await startUserTaskInstance()
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'CompleteUserTask',
            tokenId: waitingTokenId,
            completedBy: 'user-1',
          }),
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('instance')
      expect(body).toHaveProperty('events')
      expect(Array.isArray(body.events)).toBe(true)
    })

    it('200: events array contains event type strings', async () => {
      const { instanceId, waitingTokenId } = await startUserTaskInstance()
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'CompleteUserTask',
            tokenId: waitingTokenId,
            completedBy: 'user-1',
          }),
        }),
      )
      const body = await res.json()
      expect(body.events.length).toBeGreaterThan(0)
      expect(body.events.includes('ProcessInstanceCompleted')).toBe(true)
    })

    it('400: unknown command type returns 400', async () => {
      const { instanceId } = await startUserTaskInstance()
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'UnknownCommandThatDoesNotExist' }),
        }),
      )
      expect(res.status).toBe(400)
    })

    it('400: StartProcess command type is rejected', async () => {
      const { instanceId } = await startUserTaskInstance()
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'StartProcess' }),
        }),
      )
      expect(res.status).toBe(400)
    })

    it('400: missing type field returns VALIDATION_ERROR', async () => {
      const { instanceId } = await startUserTaskInstance()
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('VALIDATION_ERROR')
    })

    it('404: unknown instance id returns 404', async () => {
      const res = await app.fetch(
        new Request('http://localhost/instances/does-not-exist/commands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'CompleteUserTask',
            tokenId: 'some-token',
            completedBy: 'user-1',
          }),
        }),
      )
      expect(res.status).toBe(404)
    })

    it('422: CompleteUserTask on a token that is not waiting returns 422', async () => {
      const { instanceId, waitingTokenId } = await startUserTaskInstance()

      // First complete the user task to move the instance to completed
      await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'CompleteUserTask',
            tokenId: waitingTokenId,
            completedBy: 'user-1',
          }),
        }),
      )

      // Try to complete the same (now completed) token again
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'CompleteUserTask',
            tokenId: waitingTokenId,
            completedBy: 'user-1',
          }),
        }),
      )
      expect(res.status).toBe(422)
    })
  })

  // ─── DELETE /instances/:id ────────────────────────────────────────────────────

  describe('DELETE /instances/:id', () => {
    it('200: cancels an active instance (status becomes terminated)', async () => {
      await seedDefinition(store, USER_TASK_BPMN)
      const { instance } = await startInstance(app, 'usertask-proc')
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instance.id}`, {
          method: 'DELETE',
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.instance.status).toBe('terminated')
    })

    it('200: response includes updated instance', async () => {
      await seedDefinition(store, USER_TASK_BPMN)
      const { instance } = await startInstance(app, 'usertask-proc')
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instance.id}`, {
          method: 'DELETE',
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('instance')
      expect(body.instance.id).toBe(instance.id)
    })

    it('200: idempotent — deleting an already-terminated instance returns 200', async () => {
      await seedDefinition(store, USER_TASK_BPMN)
      const { instance } = await startInstance(app, 'usertask-proc')

      // Cancel once
      await app.fetch(
        new Request(`http://localhost/instances/${instance.id}`, {
          method: 'DELETE',
        }),
      )

      // Cancel again — should still return 200
      const res = await app.fetch(
        new Request(`http://localhost/instances/${instance.id}`, {
          method: 'DELETE',
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.instance.status).toBe('terminated')
    })

    it('404: unknown instance id returns 404', async () => {
      const res = await app.fetch(
        new Request('http://localhost/instances/does-not-exist', {
          method: 'DELETE',
        }),
      )
      expect(res.status).toBe(404)
    })

    it('200: deleting a completed instance re-emits ProcessInstanceTerminated and returns the instance', async () => {
      await seedDefinition(store, SIMPLE_BPMN)
      // simple-proc completes immediately
      const { instance } = await startInstance(app, 'simple-proc')
      expect(instance.status).toBe('completed')

      const published: string[] = []
      eventBus.subscribe(ev => { published.push(ev.type) })

      const res = await app.fetch(
        new Request(`http://localhost/instances/${instance.id}`, { method: 'DELETE' }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.instance.id).toBe(instance.id)
      expect(published).toContain('ProcessInstanceTerminated')
    })

    it('open user tasks are cancelled when the instance is terminated', async () => {
      // 1. Deploy a BPMN with a userTask and start an instance
      await seedDefinition(store, USER_TASK_BPMN)
      const { instance } = await startInstance(app, 'usertask-proc')

      // 2. Verify the user task is open
      const beforeCancel = await store.queryUserTasks({ instanceId: instance.id, status: 'open', page: 0, pageSize: 10 })
      expect(beforeCancel.items).toHaveLength(1)
      expect(beforeCancel.items[0]!.status).toBe('open')

      // 3. DELETE the instance
      const deleteRes = await app.fetch(
        new Request(`http://localhost/instances/${instance.id}`, {
          method: 'DELETE',
        }),
      )
      expect(deleteRes.status).toBe(200)

      // 4. All tasks for that instance should now be cancelled
      const afterCancel = await store.queryUserTasks({ instanceId: instance.id, page: 0, pageSize: 10 })
      expect(afterCancel.items.length).toBeGreaterThan(0)
      expect(afterCancel.items.every(t => t.status === 'cancelled')).toBe(true)
    })
  })
})
