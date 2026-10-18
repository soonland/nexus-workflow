import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { parseBpmn, InMemoryStateStore, InMemoryEventBus, type Token } from 'nexus-workflow-core'
import { createInstancesRouter } from './instances.js'
import { createTasksRouter } from './tasks.js'
import { createAdminRouter } from './admin.js'
import { createEventsRouter } from './events.js'

const USER_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.com">
  <process id="usertask-proc" name="User Task Process" isExecutable="true">
    <startEvent id="start-1"><outgoing>flow-1</outgoing></startEvent>
    <userTask id="task-1" name="Review"><incoming>flow-1</incoming><outgoing>flow-2</outgoing></userTask>
    <endEvent id="end-1"><incoming>flow-2</incoming></endEvent>
    <sequenceFlow id="flow-1" sourceRef="start-1" targetRef="task-1"/>
    <sequenceFlow id="flow-2" sourceRef="task-1" targetRef="end-1"/>
  </process>
</definitions>`

const SIGNAL_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.com">
  <process id="signal-proc" name="Signal" isExecutable="true">
    <startEvent id="start-1"><outgoing>flow-1</outgoing></startEvent>
    <intermediateCatchEvent id="catch-1"><incoming>flow-1</incoming><outgoing>flow-2</outgoing><signalEventDefinition signalRef="go"/></intermediateCatchEvent>
    <endEvent id="end-1"><incoming>flow-2</incoming></endEvent>
    <sequenceFlow id="flow-1" sourceRef="start-1" targetRef="catch-1"/>
    <sequenceFlow id="flow-2" sourceRef="catch-1" targetRef="end-1"/>
  </process>
</definitions>`

/**
 * Makes the next executeTransaction lose a race: just before it runs, "someone else" changes the
 * instance (as a concurrent request would have, after our request loaded it).
 */
function rivalWritesBeforeNextCommit(store: InMemoryStateStore, instanceId: string, status: 'active' | 'suspended' = 'suspended'): void {
  const realCommit = store.executeTransaction.bind(store)
  let armed = true
  store.executeTransaction = async (ops) => {
    if (armed) {
      armed = false
      const current = (await store.getInstance(instanceId))!
      await store.updateInstance({ ...current, status })
    }
    return realCommit(ops)
  }
}

describe('concurrent writers surface as 409 CONFLICT', () => {
  let store: InMemoryStateStore
  let app: Hono

  beforeEach(() => {
    store = new InMemoryStateStore()
    const bus = new InMemoryEventBus()
    app = new Hono()
    app.route('/', createInstancesRouter(() => store, () => bus))
    app.route('/', createTasksRouter(() => store, () => bus))
    app.route('/', createAdminRouter(() => store, () => bus))
    app.route('/', createEventsRouter(() => store, () => bus))
  })

  async function start(bpmn: string, definitionId: string) {
    const { definition } = parseBpmn(bpmn)
    await store.saveDefinition(definition!)
    const res = await app.fetch(new Request(`http://localhost/definitions/${definitionId}/instances`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }))
    const { instance, tokens } = await res.json()
    const token = tokens.find((t: Token) => t.status === 'waiting')
    return { instanceId: instance.id as string, tokenId: token?.id as string | undefined }
  }

  async function expectConflict(res: Response) {
    const body = await res.json() as { error: string; message: string }
    expect(body.error).toBe('CONFLICT')
    expect(body.message).toMatch(/reload/i)
  }

  it('POST /tasks/:id/complete', async () => {
    const { instanceId } = await start(USER_TASK_BPMN, 'usertask-proc')
    const task = (await store.queryUserTasks({ instanceId, page: 0, pageSize: 10 })).items[0]!
    rivalWritesBeforeNextCommit(store, instanceId)

    const res = await app.fetch(new Request(`http://localhost/tasks/${task.id}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completedBy: 'u1' }),
    }))

    expect(res.status).toBe(409)
    await expectConflict(res)
    // the loser wrote nothing: the rival's state stands and the task is still open
    expect((await store.getInstance(instanceId))!.status).toBe('suspended')
    expect((await store.getUserTask(task.id))!.status).not.toBe('completed')
  })

  it('POST /instances/:id/commands', async () => {
    const { instanceId, tokenId } = await start(USER_TASK_BPMN, 'usertask-proc')
    rivalWritesBeforeNextCommit(store, instanceId)

    const res = await app.fetch(new Request(`http://localhost/instances/${instanceId}/commands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'CompleteUserTask', tokenId, completedBy: 'u1' }),
    }))

    expect(res.status).toBe(409)
    await expectConflict(res)
  })

  it('POST /instances/:id/suspend', async () => {
    const { instanceId } = await start(USER_TASK_BPMN, 'usertask-proc')
    rivalWritesBeforeNextCommit(store, instanceId)

    const res = await app.fetch(new Request(`http://localhost/instances/${instanceId}/suspend`, { method: 'POST' }))

    expect(res.status).toBe(409)
    await expectConflict(res)
  })

  it('POST /signals re-loads and retries an instance that changed under it, instead of failing the broadcast', async () => {
    const { instanceId } = await start(SIGNAL_BPMN, 'signal-proc')
    rivalWritesBeforeNextCommit(store, instanceId, 'active')

    const res = await app.fetch(new Request('http://localhost/signals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signalName: 'go' }),
    }))

    expect(res.status).toBe(200)
    expect(((await res.json()) as { delivered: number }).delivered).toBe(1)
    expect((await store.getInstance(instanceId))!.status).toBe('completed')
  })
})
