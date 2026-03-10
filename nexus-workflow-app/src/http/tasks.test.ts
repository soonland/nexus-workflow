import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { parseBpmn, InMemoryStateStore, InMemoryEventBus } from 'nexus-workflow-core'
import type { Token, UserTaskRecord, ExecutionEvent } from 'nexus-workflow-core'
import { createInstancesRouter } from './instances.js'
import { createTasksRouter } from './tasks.js'

// ─── BPMN Fixtures ────────────────────────────────────────────────────────────

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

const TWO_USER_TASKS_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://example.com">
  <process id="two-tasks-proc" name="Two Tasks" isExecutable="true">
    <startEvent id="start-1">
      <outgoing>flow-1</outgoing>
    </startEvent>
    <userTask id="task-1" name="First Task">
      <incoming>flow-1</incoming>
      <outgoing>flow-2</outgoing>
    </userTask>
    <userTask id="task-2" name="Second Task">
      <incoming>flow-2</incoming>
      <outgoing>flow-3</outgoing>
    </userTask>
    <endEvent id="end-1">
      <incoming>flow-3</incoming>
    </endEvent>
    <sequenceFlow id="flow-1" sourceRef="start-1" targetRef="task-1"/>
    <sequenceFlow id="flow-2" sourceRef="task-1" targetRef="task-2"/>
    <sequenceFlow id="flow-3" sourceRef="task-2" targetRef="end-1"/>
  </process>
</definitions>`

// ─── Fixture Helpers ──────────────────────────────────────────────────────────

async function startUserTaskProcess(
  app: Hono,
  store: InMemoryStateStore,
  bpmnXml: string = USER_TASK_BPMN,
  definitionId: string = 'usertask-proc',
): Promise<{ instanceId: string; taskId: string; tokenId: string }> {
  const { definition } = parseBpmn(bpmnXml)
  await store.saveDefinition(definition!)

  const res = await app.fetch(
    new Request(`http://localhost/definitions/${definitionId}/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }),
  )
  const { instance, tokens } = await res.json()
  const waitingToken = tokens.find((t: Token) => t.status === 'waiting')!

  const tasksResult = await store.queryUserTasks({ instanceId: instance.id, page: 0, pageSize: 10 })
  const task = tasksResult.items[0]!

  return { instanceId: instance.id, taskId: task.id, tokenId: waitingToken.id }
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('tasks HTTP API', () => {
  let store: InMemoryStateStore
  let eventBus: InMemoryEventBus
  let app: Hono

  beforeEach(() => {
    store = new InMemoryStateStore()
    eventBus = new InMemoryEventBus()
    app = new Hono()
    app.route('/', createInstancesRouter(store, eventBus))
    app.route('/', createTasksRouter(store, eventBus))
  })

  // ─── GET /tasks ───────────────────────────────────────────────────────────────

  describe('GET /tasks', () => {
    it('200: empty items array when no tasks', async () => {
      const res = await app.fetch(new Request('http://localhost/tasks'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('items')
      expect(Array.isArray(body.items)).toBe(true)
      expect(body.items).toHaveLength(0)
      expect(body.total).toBe(0)
    })

    it('200: returns task after user task instance starts', async () => {
      await startUserTaskProcess(app, store)
      const res = await app.fetch(new Request('http://localhost/tasks'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items).toHaveLength(1)
      expect(body.total).toBe(1)
      expect(body.items[0].name).toBe('Review')
      expect(body.items[0].status).toBe('open')
    })

    it('200: task has required fields', async () => {
      await startUserTaskProcess(app, store)
      const res = await app.fetch(new Request('http://localhost/tasks'))
      const body = await res.json()
      const task = body.items[0]
      expect(task).toHaveProperty('id')
      expect(task).toHaveProperty('instanceId')
      expect(task).toHaveProperty('tokenId')
      expect(task).toHaveProperty('elementId')
      expect(task).toHaveProperty('status')
      expect(task).toHaveProperty('createdAt')
    })

    it('200: filters by ?instanceId — only tasks for that instance', async () => {
      const { instanceId: id1 } = await startUserTaskProcess(app, store)
      // Start a second instance (re-save same definition is fine)
      const res2 = await app.fetch(
        new Request('http://localhost/definitions/usertask-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      const { instance: inst2 } = await res2.json()

      const res = await app.fetch(
        new Request(`http://localhost/tasks?instanceId=${id1}`),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items).toHaveLength(1)
      expect(body.items[0].instanceId).toBe(id1)
      expect(body.items[0].instanceId).not.toBe(inst2.id)
    })

    it('200: filters by ?status=open — only open tasks', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      // Claim the task so it's no longer open
      await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimedBy: 'user-1' }),
        }),
      )
      const res = await app.fetch(new Request('http://localhost/tasks?status=open'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items).toHaveLength(0)
    })

    it('200: filters by ?status=claimed — only claimed tasks', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimedBy: 'user-1' }),
        }),
      )
      const res = await app.fetch(new Request('http://localhost/tasks?status=claimed'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items).toHaveLength(1)
      expect(body.items[0].status).toBe('claimed')
    })

    it('200: pagination — ?page=0&pageSize=1 with 2 tasks returns 1 item and total=2', async () => {
      // Start two instances of the same process
      await startUserTaskProcess(app, store)
      await app.fetch(
        new Request('http://localhost/definitions/usertask-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      const res = await app.fetch(new Request('http://localhost/tasks?page=0&pageSize=1'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.items).toHaveLength(1)
      expect(body.total).toBe(2)
      expect(body.page).toBe(0)
      expect(body.pageSize).toBe(1)
    })
  })

  // ─── GET /tasks/:id ───────────────────────────────────────────────────────────

  describe('GET /tasks/:id', () => {
    it('200: returns task details', async () => {
      const { taskId, instanceId, tokenId } = await startUserTaskProcess(app, store)
      const res = await app.fetch(new Request(`http://localhost/tasks/${taskId}`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('task')
      expect(body.task.id).toBe(taskId)
      expect(body.task.instanceId).toBe(instanceId)
      expect(body.task.tokenId).toBe(tokenId)
      expect(body.task.name).toBe('Review')
      expect(body.task.status).toBe('open')
    })

    it('200: includes variables field', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      const res = await app.fetch(new Request(`http://localhost/tasks/${taskId}`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('variables')
      expect(typeof body.variables).toBe('object')
    })

    it('200: variables reflect instance start variables', async () => {
      const { definition } = parseBpmn(USER_TASK_BPMN)
      await store.saveDefinition(definition!)
      const startRes = await app.fetch(
        new Request('http://localhost/definitions/usertask-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variables: { article: { type: 'string', value: 'hello' } } }),
        }),
      )
      const { instance } = await startRes.json()
      const tasksResult = await store.queryUserTasks({ instanceId: instance.id, page: 0, pageSize: 10 })
      const taskId = tasksResult.items[0]!.id

      const res = await app.fetch(new Request(`http://localhost/tasks/${taskId}`))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.variables).toHaveProperty('article')
      expect(body.variables.article).toBe('hello')
    })

    it('404: unknown task id returns 404', async () => {
      const res = await app.fetch(new Request('http://localhost/tasks/does-not-exist'))
      expect(res.status).toBe(404)
    })
  })

  // ─── POST /tasks/:id/complete ─────────────────────────────────────────────────

  describe('POST /tasks/:id/complete', () => {
    it('200: completes the task and instance progresses to completion', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      const res = await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedBy: 'user-1' }),
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.task.status).toBe('completed')
      expect(body.instance.status).toBe('completed')
    })

    it('200: response includes updated task and instance', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      const res = await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedBy: 'user-1' }),
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('task')
      expect(body).toHaveProperty('instance')
      expect(body.task.completedAt).toBeDefined()
    })

    it('200: output variables are merged into scope (visible on GET /instances/:id)', async () => {
      const { taskId, instanceId } = await startUserTaskProcess(app, store)
      await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            completedBy: 'user-1',
            outputVariables: { approved: { type: 'boolean', value: true } },
          }),
        }),
      )
      const instanceRes = await app.fetch(
        new Request(`http://localhost/instances/${instanceId}`),
      )
      const instanceBody = await instanceRes.json()
      expect(instanceBody.variables).toHaveProperty('approved')
      expect(instanceBody.variables.approved).toBe(true)
    })

    it('200: task is persisted as completed in the store', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedBy: 'user-1' }),
        }),
      )
      const stored = await store.getUserTask(taskId)
      expect(stored).not.toBeNull()
      expect(stored!.status).toBe('completed')
      expect(stored!.completedAt).toBeDefined()
    })

    it('200: events published include ProcessInstanceCompleted', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      const emitted: ExecutionEvent[] = []
      eventBus.subscribe(e => { emitted.push(e) })

      await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedBy: 'user-1' }),
        }),
      )
      expect(emitted.some(e => e.type === 'ProcessInstanceCompleted')).toBe(true)
    })

    it('200: completing first of two sequential user tasks creates the second task', async () => {
      const { definition } = parseBpmn(TWO_USER_TASKS_BPMN)
      await store.saveDefinition(definition!)
      const startRes = await app.fetch(
        new Request('http://localhost/definitions/two-tasks-proc/instances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      const { instance } = await startRes.json()
      const firstTaskResult = await store.queryUserTasks({ instanceId: instance.id, page: 0, pageSize: 10 })
      const firstTaskId = firstTaskResult.items[0]!.id

      await app.fetch(
        new Request(`http://localhost/tasks/${firstTaskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedBy: 'user-1' }),
        }),
      )

      const allTasksResult = await store.queryUserTasks({ instanceId: instance.id, page: 0, pageSize: 10 })
      expect(allTasksResult.items).toHaveLength(2)
      const secondTask = allTasksResult.items.find(t => t.elementId === 'task-2')
      expect(secondTask).toBeDefined()
      expect(secondTask!.status).toBe('open')
    })

    it('400: missing completedBy returns 400', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      const res = await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(400)
    })

    it('404: unknown task id returns 404', async () => {
      const res = await app.fetch(
        new Request('http://localhost/tasks/does-not-exist/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedBy: 'user-1' }),
        }),
      )
      expect(res.status).toBe(404)
    })

    it('422: completing an already-completed task returns 422', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedBy: 'user-1' }),
        }),
      )
      const res = await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ completedBy: 'user-1' }),
        }),
      )
      expect(res.status).toBe(422)
    })
  })

  // ─── POST /tasks/:id/claim ────────────────────────────────────────────────────

  describe('POST /tasks/:id/claim', () => {
    it('200: task status becomes claimed and assignee is set', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      const res = await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimedBy: 'user-1' }),
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.task.status).toBe('claimed')
      expect(body.task.assignee).toBe('user-1')
    })

    it('200: claimedAt is set on the task', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      const res = await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimedBy: 'user-1' }),
        }),
      )
      const body = await res.json()
      expect(body.task.claimedAt).toBeDefined()
    })

    it('200: claim is persisted in the store', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimedBy: 'user-1' }),
        }),
      )
      const stored = await store.getUserTask(taskId)
      expect(stored!.status).toBe('claimed')
      expect(stored!.assignee).toBe('user-1')
    })

    it('400: missing claimedBy returns 400', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      const res = await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(400)
    })

    it('404: unknown task id returns 404', async () => {
      const res = await app.fetch(
        new Request('http://localhost/tasks/does-not-exist/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimedBy: 'user-1' }),
        }),
      )
      expect(res.status).toBe(404)
    })
  })

  // ─── POST /tasks/:id/release ──────────────────────────────────────────────────

  describe('POST /tasks/:id/release', () => {
    it('200: task status becomes open and assignee is cleared', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      // First claim it
      await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimedBy: 'user-1' }),
        }),
      )
      const res = await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.task.status).toBe('open')
      expect(body.task.assignee).toBeUndefined()
    })

    it('200: release is persisted in the store', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/claim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimedBy: 'user-1' }),
        }),
      )
      await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      const stored = await store.getUserTask(taskId)
      expect(stored!.status).toBe('open')
      expect(stored!.assignee).toBeUndefined()
    })

    it('200: works on an open task (release is idempotent-ish)', async () => {
      const { taskId } = await startUserTaskProcess(app, store)
      const res = await app.fetch(
        new Request(`http://localhost/tasks/${taskId}/release`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.task.status).toBe('open')
    })

    it('404: unknown task id returns 404', async () => {
      const res = await app.fetch(
        new Request('http://localhost/tasks/does-not-exist/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      )
      expect(res.status).toBe(404)
    })
  })
})
