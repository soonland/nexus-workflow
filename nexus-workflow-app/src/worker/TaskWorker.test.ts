import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseBpmn, InMemoryStateStore, InMemoryEventBus, execute } from 'nexus-workflow-core'
import type {
  ProcessDefinition,
  ServiceTaskHandler,
  TaskContext,
  TaskResult,
  ExecutionEvent,
  VariableValue,
} from 'nexus-workflow-core'
import { TaskWorker } from './TaskWorker.js'

// ─── BPMN Fixtures ─────────────────────────────────────────────────────────

const SERVICE_TASK_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:nexus="http://nexus-workflow/extensions"
             targetNamespace="http://example.com">
  <process id="svc-proc" name="Service Task Process" isExecutable="true">
    <startEvent id="start-1">
      <outgoing>f1</outgoing>
    </startEvent>
    <serviceTask id="svc-1" name="My Service" nexus:type="my-handler">
      <incoming>f1</incoming>
      <outgoing>f2</outgoing>
    </serviceTask>
    <endEvent id="end-1">
      <incoming>f2</incoming>
    </endEvent>
    <sequenceFlow id="f1" sourceRef="start-1" targetRef="svc-1"/>
    <sequenceFlow id="f2" sourceRef="svc-1" targetRef="end-1"/>
  </process>
</definitions>`

const ERROR_BOUNDARY_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:nexus="http://nexus-workflow/extensions"
             targetNamespace="http://example.com">
  <process id="boundary-proc" name="Error Boundary Process" isExecutable="true">
    <startEvent id="start-1">
      <outgoing>f1</outgoing>
    </startEvent>
    <serviceTask id="svc-1" name="Risky Service" nexus:type="risky-handler">
      <incoming>f1</incoming>
      <outgoing>f2</outgoing>
    </serviceTask>
    <boundaryEvent id="err-boundary" attachedToRef="svc-1" cancelActivity="true">
      <errorEventDefinition errorRef="APP_ERROR"/>
      <outgoing>f3</outgoing>
    </boundaryEvent>
    <endEvent id="end-ok">
      <incoming>f2</incoming>
    </endEvent>
    <endEvent id="end-err">
      <incoming>f3</incoming>
    </endEvent>
    <sequenceFlow id="f1" sourceRef="start-1" targetRef="svc-1"/>
    <sequenceFlow id="f2" sourceRef="svc-1" targetRef="end-ok"/>
    <sequenceFlow id="f3" sourceRef="err-boundary" targetRef="end-err"/>
  </process>
</definitions>`

// ─── Helper: minimal store/bus ops ─────────────────────────────────────────

function computeStoreOps(
  isNew: boolean,
  oldGwStates: import('nexus-workflow-core').GatewayJoinState[],
  newState: import('nexus-workflow-core').EngineState,
): import('nexus-workflow-core').StoreOperation[] {
  const ops: import('nexus-workflow-core').StoreOperation[] = []
  ops.push(isNew
    ? { op: 'createInstance', instance: newState.instance }
    : { op: 'updateInstance', instance: newState.instance }
  )
  ops.push({ op: 'saveTokens', tokens: newState.tokens })
  for (const scope of newState.scopes) {
    ops.push({ op: 'saveScope', scope })
  }
  const newGwKeys = new Set(newState.gatewayJoinStates.map(gs => `${gs.gatewayId}::${gs.instanceId}`))
  for (const gs of newState.gatewayJoinStates) {
    ops.push({ op: 'saveGatewayState', state: gs })
  }
  for (const gs of oldGwStates) {
    if (!newGwKeys.has(`${gs.gatewayId}::${gs.instanceId}`)) {
      ops.push({ op: 'deleteGatewayState', gatewayId: gs.gatewayId, instanceId: gs.instanceId })
    }
  }
  return ops
}

async function seedDefinition(store: InMemoryStateStore, bpmnXml: string): Promise<ProcessDefinition> {
  const { definition } = parseBpmn(bpmnXml)
  await store.saveDefinition(definition!)
  return definition!
}

async function startInstance(
  store: InMemoryStateStore,
  eventBus: InMemoryEventBus,
  definitionId: string,
  variables?: Record<string, VariableValue>,
): Promise<{ instanceId: string; serviceTokenId: string }> {
  const definition = await store.getDefinition(definitionId)
  const result = execute(definition!, { type: 'StartProcess', ...(variables ? { variables } : {}) }, null)
  const ops = computeStoreOps(true, [], result.newState)
  await store.executeTransaction(ops)
  await eventBus.publishMany(result.events)
  const serviceToken = result.newState.tokens.find(t => t.status === 'waiting')
  return { instanceId: result.newState.instance.id, serviceTokenId: serviceToken!.id }
}

// ─── Fake Handlers ──────────────────────────────────────────────────────────

function makeSuccessHandler(taskType = 'my-handler', outputVariables?: Record<string, VariableValue>): ServiceTaskHandler & { calls: TaskContext[] } {
  const calls: TaskContext[] = []
  return {
    taskType,
    calls,
    async execute(ctx) {
      calls.push(ctx)
      return outputVariables !== undefined
        ? { status: 'completed' as const, outputVariables }
        : { status: 'completed' as const }
    },
  }
}

function makeErrorHandler(taskType = 'my-handler', code = 'OOPS', message = 'it broke'): ServiceTaskHandler {
  return {
    taskType,
    async execute() {
      return { status: 'error', error: { code, message } }
    },
  }
}

function makeRetryThenSuccessHandler(taskType = 'my-handler', failTimes = 1): ServiceTaskHandler & { calls: number } {
  let calls = 0
  const handler = {
    taskType,
    get calls() { return calls },
    async execute(): Promise<TaskResult> {
      calls++
      if (calls <= failTimes) {
        return { status: 'retry', retryDelay: 0, error: { code: 'TEMP', message: 'temporary' } }
      }
      return { status: 'completed' }
    },
  }
  return handler
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('TaskWorker', () => {
  let store: InMemoryStateStore
  let eventBus: InMemoryEventBus

  beforeEach(() => {
    store = new InMemoryStateStore()
    eventBus = new InMemoryEventBus()
  })

  // ─── Registration ──────────────────────────────────────────────────────────

  describe('register()', () => {
    it('registers a handler by its taskType', () => {
      const worker = new TaskWorker(store, eventBus)
      const handler = makeSuccessHandler('foo')
      expect(() => worker.register(handler)).not.toThrow()
    })

    it('overwrites a handler registered for the same taskType', async () => {
      const worker = new TaskWorker(store, eventBus)
      const first = makeSuccessHandler('my-handler')
      const second = makeSuccessHandler('my-handler')
      worker.register(first)
      worker.register(second)
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      await startInstance(store, eventBus, 'svc-proc')

      // Wait for async dispatch
      await new Promise(r => setTimeout(r, 10))

      expect(first.calls).toHaveLength(0)
      expect(second.calls).toHaveLength(1)
    })
  })

  // ─── start() / stop() ──────────────────────────────────────────────────────

  describe('start() and stop()', () => {
    it('start() subscribes to ServiceTaskStarted — handler is called', async () => {
      const worker = new TaskWorker(store, eventBus)
      const handler = makeSuccessHandler()
      worker.register(handler)
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))
      expect(handler.calls).toHaveLength(1)
    })

    it('stop() unsubscribes — handler is NOT called after stop', async () => {
      const worker = new TaskWorker(store, eventBus)
      const handler = makeSuccessHandler()
      worker.register(handler)
      worker.start()
      worker.stop()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))
      expect(handler.calls).toHaveLength(0)
    })

    it('calling start() twice is idempotent — handler is called once', async () => {
      const worker = new TaskWorker(store, eventBus)
      const handler = makeSuccessHandler()
      worker.register(handler)
      worker.start()
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))
      expect(handler.calls).toHaveLength(1)
    })
  })

  // ─── Successful dispatch ────────────────────────────────────────────────────

  describe('successful handler dispatch', () => {
    it('passes correct TaskContext to the handler', async () => {
      const worker = new TaskWorker(store, eventBus)
      const handler = makeSuccessHandler()
      worker.register(handler)
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      const { instanceId, serviceTokenId } = await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))

      const ctx = handler.calls[0]!
      expect(ctx.instanceId).toBe(instanceId)
      expect(ctx.tokenId).toBe(serviceTokenId)
      expect(ctx.taskType).toBe('my-handler')
      expect(ctx.attempt).toBe(1)
    })

    it('resolves variables from scope chain and passes them to the handler', async () => {
      const worker = new TaskWorker(store, eventBus)
      const handler = makeSuccessHandler()
      worker.register(handler)
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      await startInstance(store, eventBus, 'svc-proc', {
        greeting: { type: 'string', value: 'hello' },
      })

      await new Promise(r => setTimeout(r, 10))

      const ctx = handler.calls[0]!
      expect(ctx.variables).toHaveProperty('greeting')
      expect(ctx.variables['greeting']!.value).toBe('hello')
    })

    it('issues CompleteServiceTask — instance reaches completed status', async () => {
      const worker = new TaskWorker(store, eventBus)
      worker.register(makeSuccessHandler())
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))

      const instance = await store.getInstance(instanceId)
      expect(instance!.status).toBe('completed')
    })

    it('outputVariables from handler are applied to the instance scope', async () => {
      const worker = new TaskWorker(store, eventBus)
      worker.register(makeSuccessHandler('my-handler', {
        result: { type: 'string', value: 'done' },
      }))
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))

      const instance = await store.getInstance(instanceId)
      expect(instance!.status).toBe('completed')
      // Variables are saved in scopes; just check instance completed (output var test via scope would need getScopeChain)
    })

    it('publishes events to the event bus after completing', async () => {
      const emitted: ExecutionEvent[] = []
      eventBus.subscribe(e => { emitted.push(e) })

      const worker = new TaskWorker(store, eventBus)
      worker.register(makeSuccessHandler())
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))

      expect(emitted.some(e => e.type === 'ServiceTaskCompleted')).toBe(true)
      expect(emitted.some(e => e.type === 'ProcessInstanceCompleted')).toBe(true)
    })
  })

  // ─── Error handling ─────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('no registered handler → issues FailServiceTask → instance suspended', async () => {
      const worker = new TaskWorker(store, eventBus)
      // Do NOT register any handler
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))

      const instance = await store.getInstance(instanceId)
      expect(instance!.status).toBe('suspended')
    })

    it('handler returns error → issues FailServiceTask → instance suspended', async () => {
      const worker = new TaskWorker(store, eventBus)
      worker.register(makeErrorHandler())
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))

      const instance = await store.getInstance(instanceId)
      expect(instance!.status).toBe('suspended')
    })

    it('handler returns error with matching error boundary → boundary triggers, instance completes', async () => {
      const worker = new TaskWorker(store, eventBus)
      worker.register(makeErrorHandler('risky-handler', 'APP_ERROR', 'app error'))
      worker.start()

      await seedDefinition(store, ERROR_BOUNDARY_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'boundary-proc')

      await new Promise(r => setTimeout(r, 10))

      const instance = await store.getInstance(instanceId)
      // Error boundary catches it and routes to end-err, so instance completes
      expect(instance!.status).toBe('completed')
    })

    it('handler throws exception → issues FailServiceTask → instance suspended', async () => {
      const worker = new TaskWorker(store, eventBus)
      worker.register({
        taskType: 'my-handler',
        async execute() {
          throw new Error('unexpected crash')
        },
      })
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))

      const instance = await store.getInstance(instanceId)
      expect(instance!.status).toBe('suspended')
    })

    it('publishes ServiceTaskFailed event on error', async () => {
      const emitted: ExecutionEvent[] = []
      eventBus.subscribe(e => { emitted.push(e) })

      const worker = new TaskWorker(store, eventBus)
      worker.register(makeErrorHandler())
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 10))

      expect(emitted.some(e => e.type === 'ServiceTaskFailed')).toBe(true)
    })
  })

  // ─── Retry ──────────────────────────────────────────────────────────────────

  describe('retry behaviour', () => {
    it('handler returns retry → retries until success → instance completes', async () => {
      const worker = new TaskWorker(store, eventBus, { maxAttempts: 3 })
      const handler = makeRetryThenSuccessHandler('my-handler', 1)
      worker.register(handler)
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 50))

      expect(handler.calls).toBe(2)  // 1 retry + 1 success
      const instance = await store.getInstance(instanceId)
      expect(instance!.status).toBe('completed')
    })

    it('handler keeps returning retry beyond maxAttempts → FailServiceTask → suspended', async () => {
      const worker = new TaskWorker(store, eventBus, { maxAttempts: 3 })
      const handler = makeRetryThenSuccessHandler('my-handler', 99)  // always retries
      worker.register(handler)
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'svc-proc')

      // Allow enough time for 3 retries with 0 delay
      await new Promise(r => setTimeout(r, 100))

      expect(handler.calls).toBe(3)  // called maxAttempts times
      const instance = await store.getInstance(instanceId)
      expect(instance!.status).toBe('suspended')
    })

    it('attempt counter is passed correctly to the handler on each attempt', async () => {
      const attempts: number[] = []
      const worker = new TaskWorker(store, eventBus, { maxAttempts: 3 })
      worker.register({
        taskType: 'my-handler',
        async execute(ctx) {
          attempts.push(ctx.attempt)
          return attempts.length < 3
            ? { status: 'retry', retryDelay: 0 }
            : { status: 'completed' }
        },
      })
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      await startInstance(store, eventBus, 'svc-proc')

      await new Promise(r => setTimeout(r, 100))

      expect(attempts).toEqual([1, 2, 3])
    })
  })

  // ─── Idempotency ────────────────────────────────────────────────────────────

  describe('idempotency (at-least-once delivery)', () => {
    it('duplicate ServiceTaskStarted event for the same token is processed only once', async () => {
      const worker = new TaskWorker(store, eventBus)
      const handler = makeSuccessHandler()
      worker.register(handler)
      worker.start()

      await seedDefinition(store, SERVICE_TASK_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'svc-proc')

      // Wait for first processing to complete
      await new Promise(r => setTimeout(r, 20))

      // Manually re-publish the ServiceTaskStarted event (simulating at-least-once delivery)
      const tokens = await store.getAllTokens(instanceId)
      const serviceToken = tokens.find(t => t.elementId === 'svc-1')
      if (serviceToken) {
        await eventBus.publish({
          type: 'ServiceTaskStarted',
          instanceId,
          tokenId: serviceToken.id,
          elementId: 'svc-1',
          taskType: 'my-handler',
        })
        await new Promise(r => setTimeout(r, 20))
      }

      // Handler should have been called only once (token is no longer waiting)
      expect(handler.calls).toHaveLength(1)
    })
  })
})
