import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { parseBpmn, InMemoryStateStore, InMemoryEventBus, InMemoryScheduler, execute } from 'nexus-workflow-core'
// 5 minutes + 1 second in ms — enough to make timer-1 (PT5M) and timer-boundary (PT1H) both "due"
const ADVANCE_PAST_5M = 5 * 60 * 1000 + 1000
const ADVANCE_PAST_1H = 60 * 60 * 1000 + 1000
import type { ProcessDefinition, ExecutionEvent } from 'nexus-workflow-core'
import { TimerCoordinator } from './TimerCoordinator.js'

// ─── BPMN Fixtures ─────────────────────────────────────────────────────────

const INTERMEDIATE_TIMER_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://example.com">
  <process id="timer-proc" name="Timer Process" isExecutable="true">
    <startEvent id="start-1">
      <outgoing>f1</outgoing>
    </startEvent>
    <intermediateCatchEvent id="timer-1">
      <incoming>f1</incoming>
      <outgoing>f2</outgoing>
      <timerEventDefinition>
        <timeDuration>PT5M</timeDuration>
      </timerEventDefinition>
    </intermediateCatchEvent>
    <endEvent id="end-1">
      <incoming>f2</incoming>
    </endEvent>
    <sequenceFlow id="f1" sourceRef="start-1" targetRef="timer-1"/>
    <sequenceFlow id="f2" sourceRef="timer-1" targetRef="end-1"/>
  </process>
</definitions>`

const BOUNDARY_TIMER_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:nexus="http://nexus-workflow/extensions"
             targetNamespace="http://example.com">
  <process id="boundary-timer-proc" name="Boundary Timer Process" isExecutable="true">
    <startEvent id="start-1">
      <outgoing>f1</outgoing>
    </startEvent>
    <userTask id="task-1" name="Review">
      <incoming>f1</incoming>
      <outgoing>f2</outgoing>
    </userTask>
    <boundaryEvent id="timer-boundary" attachedToRef="task-1" cancelActivity="true">
      <timerEventDefinition>
        <timeDuration>PT1H</timeDuration>
      </timerEventDefinition>
      <outgoing>f3</outgoing>
    </boundaryEvent>
    <endEvent id="end-ok">
      <incoming>f2</incoming>
    </endEvent>
    <endEvent id="end-timeout">
      <incoming>f3</incoming>
    </endEvent>
    <sequenceFlow id="f1" sourceRef="start-1" targetRef="task-1"/>
    <sequenceFlow id="f2" sourceRef="task-1" targetRef="end-ok"/>
    <sequenceFlow id="f3" sourceRef="timer-boundary" targetRef="end-timeout"/>
  </process>
</definitions>`

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildStoreOps(
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
  for (const scope of newState.scopes) ops.push({ op: 'saveScope', scope })
  const newGwKeys = new Set(newState.gatewayJoinStates.map(gs => `${gs.gatewayId}::${gs.instanceId}`))
  for (const gs of newState.gatewayJoinStates) ops.push({ op: 'saveGatewayState', state: gs })
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
): Promise<{ instanceId: string }> {
  const definition = await store.getDefinition(definitionId)
  const result = execute(definition!, { type: 'StartProcess' }, null)
  await store.executeTransaction(buildStoreOps(true, [], result.newState))
  await eventBus.publishMany(result.events)
  return { instanceId: result.newState.instance.id }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('TimerCoordinator', () => {
  let store: InMemoryStateStore
  let eventBus: InMemoryEventBus
  let inMemoryScheduler: InMemoryScheduler
  let coordinator: TimerCoordinator

  beforeEach(() => {
    vi.useFakeTimers()
    store = new InMemoryStateStore()
    eventBus = new InMemoryEventBus()
    // Do NOT call inMemoryScheduler.start() — we want to control firing via tickDue()
    // so armTimeout() never gets called and timers stay in the map until we're ready.
    inMemoryScheduler = new InMemoryScheduler()
    coordinator = new TimerCoordinator(store, eventBus, inMemoryScheduler)
  })

  afterEach(() => {
    coordinator.stop()
    vi.useRealTimers()
  })

  // ─── Token → schedule ──────────────────────────────────────────────────────

  describe('TokenWaiting (timer) → scheduler.schedule()', () => {
    it('schedules a timer when an intermediate timer token starts waiting', async () => {
      coordinator.start()

      await seedDefinition(store, INTERMEDIATE_TIMER_BPMN)
      await startInstance(store, eventBus, 'timer-proc')

      const timers = inMemoryScheduler.getAll()
      expect(timers).toHaveLength(1)
      expect(timers[0]!.instanceId).toBeDefined()
    })

    it('scheduled timer has fireAt ~5 minutes in the future', async () => {
      coordinator.start()
      await inMemoryScheduler.start()

      const before = vi.getMockedSystemTime()!.valueOf()
      await seedDefinition(store, INTERMEDIATE_TIMER_BPMN)
      await startInstance(store, eventBus, 'timer-proc')

      const timers = inMemoryScheduler.getAll()
      expect(timers).toHaveLength(1)
      const delta = timers[0]!.fireAt.getTime() - before
      // Should be approximately 5 minutes (±5 seconds tolerance)
      expect(delta).toBeGreaterThan(5 * 60 * 1000 - 5000)
      expect(delta).toBeLessThan(5 * 60 * 1000 + 5000)
    })

    it('does not schedule a timer for non-timer waiting tokens (user task)', async () => {
      coordinator.start()

      await seedDefinition(store, BOUNDARY_TIMER_BPMN)
      await startInstance(store, eventBus, 'boundary-timer-proc')

      // Only boundary timer token should be scheduled (not the user task token)
      const timers = inMemoryScheduler.getAll()
      expect(timers).toHaveLength(1)
    })
  })

  // ─── Timer fires → FireTimer ────────────────────────────────────────────────

  describe('timer fires → engine FireTimer → instance advances', () => {
    it('intermediate timer: instance completes after timer fires', async () => {
      coordinator.start()

      await seedDefinition(store, INTERMEDIATE_TIMER_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'timer-proc')

      // Instance is active (waiting on timer)
      const before = await store.getInstance(instanceId)
      expect(before!.status).toBe('active')

      // Advance fake time past the 5-minute timer and fire due timers
      vi.advanceTimersByTime(ADVANCE_PAST_5M)
      await inMemoryScheduler.tickDue()

      const after = await store.getInstance(instanceId)
      expect(after!.status).toBe('completed')
    })

    it('TimerFired event is emitted after the timer fires', async () => {
      const emitted: ExecutionEvent[] = []
      eventBus.subscribe(e => { emitted.push(e) })

      coordinator.start()

      await seedDefinition(store, INTERMEDIATE_TIMER_BPMN)
      await startInstance(store, eventBus, 'timer-proc')

      vi.advanceTimersByTime(ADVANCE_PAST_5M)
      await inMemoryScheduler.tickDue()

      expect(emitted.some(e => e.type === 'TimerFired')).toBe(true)
      expect(emitted.some(e => e.type === 'ProcessInstanceCompleted')).toBe(true)
    })

    it('idempotency: firing the timer twice only advances the instance once', async () => {
      coordinator.start()

      await seedDefinition(store, INTERMEDIATE_TIMER_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'timer-proc')

      await inMemoryScheduler.tickDue()

      // Manually replay the timer fired callback with the same timer
      const tokens = await store.getAllTokens(instanceId)
      const timerToken = tokens.find(t => t.elementId === 'timer-1')

      if (timerToken) {
        // Simulate duplicate: call onTimerFired again (token no longer waiting → no-op)
        const instance = await store.getInstance(instanceId)
        // Re-call coordinator's logic by scheduling a fake timer with same tokenId
        // (This is an internal idempotency check — token is no longer 'waiting')
        const coordinator2 = new TimerCoordinator(store, eventBus, inMemoryScheduler)
        coordinator2.start()
        // Fire again — should be a no-op since token is no longer waiting
        await (coordinator2 as unknown as { onTimerFired(t: unknown): Promise<void> })['onTimerFired']?.call(coordinator2, {
          id: timerToken.id,
          instanceId,
          tokenId: timerToken.id,
          fireAt: new Date(),
          createdAt: new Date(),
        })
        coordinator2.stop()
      }

      const final = await store.getInstance(instanceId)
      expect(final!.status).toBe('completed')
    })
  })

  // ─── TokenCancelled → cancel ────────────────────────────────────────────────

  describe('TokenCancelled → scheduler.cancel()', () => {
    it('cancels the timer when a boundary timer token is cancelled (task completed before timeout)', async () => {
      coordinator.start()

      await seedDefinition(store, BOUNDARY_TIMER_BPMN)
      const { instanceId } = await startInstance(store, eventBus, 'boundary-timer-proc')

      // Boundary timer should be scheduled
      expect(inMemoryScheduler.getAll()).toHaveLength(1)

      // Complete the user task — this should cancel the boundary timer token,
      // triggering TokenCancelled → coordinator cancels the timer
      const tokens = await store.getActiveTokens(instanceId)
      const userTaskToken = tokens.find(t => t.elementId === 'task-1' && t.status === 'waiting')
      expect(userTaskToken).toBeDefined()

      const state = await loadEngineState(store, instanceId)
      const definition = await store.getDefinition('boundary-timer-proc')
      const result = execute(definition!, { type: 'CompleteUserTask', tokenId: userTaskToken!.id, completedBy: 'user-1' }, state!)
      await store.executeTransaction(buildStoreOps(false, [], result.newState))
      await eventBus.publishMany(result.events)

      // Timer should be cancelled (coordinator heard TokenCancelled)
      expect(inMemoryScheduler.getAll()).toHaveLength(0)
    })
  })

  // ─── stop() ────────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('after stop(), TokenWaiting events no longer schedule timers', async () => {
      coordinator.start()
      coordinator.stop()
      await inMemoryScheduler.start()

      await seedDefinition(store, INTERMEDIATE_TIMER_BPMN)
      await startInstance(store, eventBus, 'timer-proc')

      expect(inMemoryScheduler.getAll()).toHaveLength(0)
    })
  })
})

// ─── Helper: load engine state from InMemoryStateStore ─────────────────────

async function loadEngineState(
  store: InMemoryStateStore,
  instanceId: string,
): Promise<import('nexus-workflow-core').EngineState | null> {
  const instance = await store.getInstance(instanceId)
  if (!instance) return null
  const tokens = await store.getAllTokens(instanceId)
  const gatewayJoinStates = await store.listGatewayStates(instanceId)
  const scopeIds = new Set<string>([instance.rootScopeId, ...tokens.map(t => t.scopeId)])
  const scopes: import('nexus-workflow-core').VariableScope[] = []
  for (const id of scopeIds) {
    const scope = await store.getScope(id)
    if (scope) scopes.push(scope)
  }
  return { instance, tokens, scopes, gatewayJoinStates }
}
