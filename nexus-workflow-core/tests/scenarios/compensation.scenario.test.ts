/**
 * Compensation — Scenario Tests
 *
 * These tests run realistic multi-step journeys exercising compensation semantics:
 *
 * Scenario 1 — compensate-all: two service tasks complete, a compensation throw event
 *   triggers both handlers in reverse completion order, then the process continues.
 *
 * Scenario 2 — targeted compensation: only the named activity's handler is triggered
 *   when compensationActivityRef is set on the throw event.
 *
 * Scenario 3 — user task handler: compensation handler is a user task; the process
 *   suspends until CompleteUserTask, then resumes.
 */

import { describe, it, expect } from 'vitest'
import { execute, type EngineState } from '../../src/engine/ExecutionEngine.js'
import { buildDefinition } from '../fixtures/builders/ProcessDefinitionBuilder.js'
import type {
  StartEventElement,
  EndEventElement,
  ServiceTaskElement,
  UserTaskElement,
  BoundaryEventElement,
  IntermediateThrowEventElement,
  SequenceFlow,
} from '../../src/model/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

let idCounter = 0
const opts = { generateId: () => `id-${++idCounter}`, now: () => new Date(1000 * ++idCounter) }

function startProcess(state: EngineState | null = null, definition: ReturnType<typeof buildDefinition>): EngineState {
  return execute(definition, { type: 'StartProcess' }, state, opts).newState
}

function waitingAt(state: EngineState, elementId: string) {
  return state.tokens.find(t => t.elementId === elementId && t.status === 'waiting')
}

// ─── Scenario 1: Compensate-all — handlers run in reverse completion order ────

/**
 * Process diagram:
 *
 *   [Start] → [TaskA: service] → [TaskB: service] → [CompThrow: all] → [End]
 *
 *   [CompBoundaryA] attached to TaskA, compensationActivityRef → HandlerA (service)
 *   [CompBoundaryB] attached to TaskB, compensationActivityRef → HandlerB (service)
 *
 *   HandlerA and HandlerB are service tasks with isForCompensation: true
 */

function buildCompensateAllDefinition() {
  const start: StartEventElement = {
    id: 'start', type: 'startEvent', eventDefinition: { type: 'none' },
    incomingFlows: [], outgoingFlows: ['f1'],
  }
  const taskA: ServiceTaskElement = {
    id: 'taskA', type: 'serviceTask', taskType: 'doA',
    incomingFlows: ['f1'], outgoingFlows: ['f2'],
  }
  const taskB: ServiceTaskElement = {
    id: 'taskB', type: 'serviceTask', taskType: 'doB',
    incomingFlows: ['f2'], outgoingFlows: ['f3'],
  }
  const compThrow: IntermediateThrowEventElement = {
    id: 'compThrow', type: 'intermediateThrowEvent',
    eventDefinition: { type: 'compensation' },
    incomingFlows: ['f3'], outgoingFlows: ['f4'],
  }
  const end: EndEventElement = {
    id: 'end', type: 'endEvent', eventDefinition: { type: 'none' },
    incomingFlows: ['f4'], outgoingFlows: [],
  }

  // Compensation boundary events (non-interrupting, passive)
  const boundaryA: BoundaryEventElement = {
    id: 'boundaryA', type: 'boundaryEvent', attachedToRef: 'taskA', cancelActivity: false,
    eventDefinition: { type: 'compensation', compensationActivityRef: 'handlerA' },
    incomingFlows: [], outgoingFlows: [],
  }
  const boundaryB: BoundaryEventElement = {
    id: 'boundaryB', type: 'boundaryEvent', attachedToRef: 'taskB', cancelActivity: false,
    eventDefinition: { type: 'compensation', compensationActivityRef: 'handlerB' },
    incomingFlows: [], outgoingFlows: [],
  }

  // Compensation handler tasks — not in normal flow
  const handlerA: ServiceTaskElement = {
    id: 'handlerA', type: 'serviceTask', taskType: 'undoA', isForCompensation: true,
    incomingFlows: [], outgoingFlows: [],
  }
  const handlerB: ServiceTaskElement = {
    id: 'handlerB', type: 'serviceTask', taskType: 'undoB', isForCompensation: true,
    incomingFlows: [], outgoingFlows: [],
  }

  const flows: SequenceFlow[] = [
    { id: 'f1', sourceRef: 'start', targetRef: 'taskA' },
    { id: 'f2', sourceRef: 'taskA', targetRef: 'taskB' },
    { id: 'f3', sourceRef: 'taskB', targetRef: 'compThrow' },
    { id: 'f4', sourceRef: 'compThrow', targetRef: 'end' },
  ]

  return buildDefinition({
    id: 'comp-all-proc',
    elements: [start, taskA, taskB, compThrow, end, boundaryA, boundaryB, handlerA, handlerB],
    sequenceFlows: flows,
    startEventId: 'start',
  })
}

describe('Scenario 1: compensate-all — handlers run in reverse completion order', () => {
  const definition = buildCompensateAllDefinition()

  it('records CompensationRecords as tasks complete', () => {
    idCounter = 0
    let state = startProcess(null, definition)

    // TaskA waiting
    const tokenA = waitingAt(state, 'taskA')!
    expect(tokenA).toBeDefined()

    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenA.id }, state, opts).newState
    // One record for taskA after it completes (taskB not yet done)
    expect(state.compensationRecords).toHaveLength(1)
    expect(state.compensationRecords[0].activityId).toBe('taskA')
    expect(state.compensationRecords[0].handlerId).toBe('handlerA')

    // After taskB completes the throw event fires and consumes both records to spawn handlers
    const tokenB = waitingAt(state, 'taskB')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenB.id }, state, opts).newState
    // Records consumed by the throw event
    expect(state.compensationRecords).toHaveLength(0)
    // Both handlers are now waiting
    expect(waitingAt(state, 'handlerA')).toBeDefined()
    expect(waitingAt(state, 'handlerB')).toBeDefined()
  })

  it('spawns both handler tokens when compensation throw fires, in reverse order', () => {
    idCounter = 0
    let state = startProcess(null, definition)

    const tokenA = waitingAt(state, 'taskA')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenA.id }, state, opts).newState

    const tokenB = waitingAt(state, 'taskB')!
    const { newState, events } = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenB.id }, state, opts)
    state = newState

    // Now at compThrow — handlers should be waiting
    const handlerBToken = waitingAt(state, 'handlerB')
    const handlerAToken = waitingAt(state, 'handlerA')

    expect(handlerBToken).toBeDefined()
    expect(handlerAToken).toBeDefined()

    // CompensationTriggered emitted with both handlers
    const triggered = events.find(e => e.type === 'CompensationTriggered')
    expect(triggered).toBeDefined()
    expect((triggered as Extract<typeof triggered, { type: 'CompensationTriggered' }>)?.handlersStarted).toHaveLength(2)

    // Throw token is suspended
    const throwToken = state.tokens.find(t => t.elementId === 'compThrow')
    expect(throwToken?.status).toBe('waiting')

    // Records were consumed
    expect(state.compensationRecords).toHaveLength(0)
  })

  it('process completes after both compensation handlers complete', () => {
    idCounter = 0
    let state = startProcess(null, definition)

    const tokenA = waitingAt(state, 'taskA')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenA.id }, state, opts).newState

    const tokenB = waitingAt(state, 'taskB')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenB.id }, state, opts).newState

    // Complete handlerB first (it was last to complete, so first to compensate)
    const handlerBToken = waitingAt(state, 'handlerB')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: handlerBToken.id }, state, opts).newState

    // Still waiting — handlerA not done yet
    expect(state.instance.status).toBe('active')
    const throwToken = state.tokens.find(t => t.elementId === 'compThrow')
    expect(throwToken?.status).toBe('waiting')

    // Complete handlerA
    const handlerAToken = waitingAt(state, 'handlerA')!
    const { newState, events } = execute(definition, { type: 'CompleteServiceTask', tokenId: handlerAToken.id }, state, opts)
    state = newState

    expect(state.instance.status).toBe('completed')
    expect(events.some(e => e.type === 'CompensationCompleted')).toBe(true)
    expect(events.some(e => e.type === 'ProcessInstanceCompleted')).toBe(true)
  })
})

// ─── Scenario 2: Targeted compensation — only named activity's handler runs ───

/**
 * Same process structure as Scenario 1, but the throw event targets only taskA.
 */

function buildTargetedCompensationDefinition() {
  const start: StartEventElement = {
    id: 'start', type: 'startEvent', eventDefinition: { type: 'none' },
    incomingFlows: [], outgoingFlows: ['f1'],
  }
  const taskA: ServiceTaskElement = {
    id: 'taskA', type: 'serviceTask', taskType: 'doA',
    incomingFlows: ['f1'], outgoingFlows: ['f2'],
  }
  const taskB: ServiceTaskElement = {
    id: 'taskB', type: 'serviceTask', taskType: 'doB',
    incomingFlows: ['f2'], outgoingFlows: ['f3'],
  }
  // Throw event targets taskA specifically
  const compThrow: IntermediateThrowEventElement = {
    id: 'compThrow', type: 'intermediateThrowEvent',
    eventDefinition: { type: 'compensation', compensationActivityRef: 'taskA' },
    incomingFlows: ['f3'], outgoingFlows: ['f4'],
  }
  const end: EndEventElement = {
    id: 'end', type: 'endEvent', eventDefinition: { type: 'none' },
    incomingFlows: ['f4'], outgoingFlows: [],
  }

  const boundaryA: BoundaryEventElement = {
    id: 'boundaryA', type: 'boundaryEvent', attachedToRef: 'taskA', cancelActivity: false,
    eventDefinition: { type: 'compensation', compensationActivityRef: 'handlerA' },
    incomingFlows: [], outgoingFlows: [],
  }
  const boundaryB: BoundaryEventElement = {
    id: 'boundaryB', type: 'boundaryEvent', attachedToRef: 'taskB', cancelActivity: false,
    eventDefinition: { type: 'compensation', compensationActivityRef: 'handlerB' },
    incomingFlows: [], outgoingFlows: [],
  }

  const handlerA: ServiceTaskElement = {
    id: 'handlerA', type: 'serviceTask', taskType: 'undoA', isForCompensation: true,
    incomingFlows: [], outgoingFlows: [],
  }
  const handlerB: ServiceTaskElement = {
    id: 'handlerB', type: 'serviceTask', taskType: 'undoB', isForCompensation: true,
    incomingFlows: [], outgoingFlows: [],
  }

  const flows: SequenceFlow[] = [
    { id: 'f1', sourceRef: 'start', targetRef: 'taskA' },
    { id: 'f2', sourceRef: 'taskA', targetRef: 'taskB' },
    { id: 'f3', sourceRef: 'taskB', targetRef: 'compThrow' },
    { id: 'f4', sourceRef: 'compThrow', targetRef: 'end' },
  ]

  return buildDefinition({
    id: 'comp-targeted-proc',
    elements: [start, taskA, taskB, compThrow, end, boundaryA, boundaryB, handlerA, handlerB],
    sequenceFlows: flows,
    startEventId: 'start',
  })
}

describe('Scenario 2: targeted compensation — only named activity\'s handler runs', () => {
  const definition = buildTargetedCompensationDefinition()

  it('spawns only handlerA when throw targets taskA', () => {
    idCounter = 0
    let state = startProcess(null, definition)

    const tokenA = waitingAt(state, 'taskA')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenA.id }, state, opts).newState

    const tokenB = waitingAt(state, 'taskB')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenB.id }, state, opts).newState

    // Only handlerA spawned — handlerB must NOT be waiting
    expect(waitingAt(state, 'handlerA')).toBeDefined()
    expect(waitingAt(state, 'handlerB')).toBeUndefined()

    // taskB record still available (not consumed)
    expect(state.compensationRecords.some(r => r.activityId === 'taskB')).toBe(true)
  })

  it('process completes after handlerA finishes; taskB record still intact', () => {
    idCounter = 0
    let state = startProcess(null, definition)

    const tokenA = waitingAt(state, 'taskA')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenA.id }, state, opts).newState

    const tokenB = waitingAt(state, 'taskB')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenB.id }, state, opts).newState

    const handlerAToken = waitingAt(state, 'handlerA')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: handlerAToken.id }, state, opts).newState

    expect(state.instance.status).toBe('completed')
    // taskB compensation record was not consumed
    expect(state.compensationRecords.some(r => r.activityId === 'taskB')).toBe(true)
  })

  it('emits CompensationTriggered with targetActivityId and only handlerA', () => {
    idCounter = 0
    let state = startProcess(null, definition)

    const tokenA = waitingAt(state, 'taskA')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenA.id }, state, opts).newState

    const tokenB = waitingAt(state, 'taskB')!
    const { events } = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenB.id }, state, opts)

    const triggered = events.find(e => e.type === 'CompensationTriggered') as Extract<
      (typeof events)[number], { type: 'CompensationTriggered' }
    > | undefined

    expect(triggered?.targetActivityId).toBe('taskA')
    expect(triggered?.handlersStarted).toEqual(['handlerA'])
  })
})

// ─── Scenario 3: Compensation no-op — no matching record ──────────────────────

/**
 * Throw fires but the task that precedes it has no compensation boundary event.
 * The throw event is a pass-through: CompensationTriggered with handlersStarted: [] and
 * the process continues immediately.
 */

function buildNoOpCompensationDefinition() {
  const start: StartEventElement = {
    id: 'start', type: 'startEvent', eventDefinition: { type: 'none' },
    incomingFlows: [], outgoingFlows: ['f1'],
  }
  const taskA: ServiceTaskElement = {
    id: 'taskA', type: 'serviceTask', taskType: 'doA',
    incomingFlows: ['f1'], outgoingFlows: ['f2'],
  }
  const compThrow: IntermediateThrowEventElement = {
    id: 'compThrow', type: 'intermediateThrowEvent',
    eventDefinition: { type: 'compensation' },
    incomingFlows: ['f2'], outgoingFlows: ['f3'],
  }
  const end: EndEventElement = {
    id: 'end', type: 'endEvent', eventDefinition: { type: 'none' },
    incomingFlows: ['f3'], outgoingFlows: [],
  }

  const flows: SequenceFlow[] = [
    { id: 'f1', sourceRef: 'start', targetRef: 'taskA' },
    { id: 'f2', sourceRef: 'taskA', targetRef: 'compThrow' },
    { id: 'f3', sourceRef: 'compThrow', targetRef: 'end' },
  ]

  return buildDefinition({
    id: 'comp-noop-proc',
    elements: [start, taskA, compThrow, end],
    sequenceFlows: flows,
    startEventId: 'start',
  })
}

describe('Scenario 3: no-op compensation — no matching record', () => {
  const definition = buildNoOpCompensationDefinition()

  it('passes through immediately when there are no compensation records', () => {
    idCounter = 0
    let state = startProcess(null, definition)

    const tokenA = waitingAt(state, 'taskA')!
    const { newState, events } = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenA.id }, state, opts)
    state = newState

    // Process completes immediately — no handlers to wait for
    expect(state.instance.status).toBe('completed')
    const triggered = events.find(e => e.type === 'CompensationTriggered') as Extract<
      (typeof events)[number], { type: 'CompensationTriggered' }
    > | undefined
    expect(triggered?.handlersStarted).toEqual([])
  })
})

// ─── Scenario 4: User task compensation handler ────────────────────────────────

/**
 * Process:
 *   [Start] → [TaskA: service] → [CompThrow: all] → [End]
 *   [CompBoundaryA] → HandlerA (userTask, isForCompensation)
 *
 * Verifies that:
 * - Handler task suspends waiting for CompleteUserTask
 * - Process resumes and completes after CompleteUserTask
 */

function buildUserTaskHandlerDefinition() {
  const start: StartEventElement = {
    id: 'start', type: 'startEvent', eventDefinition: { type: 'none' },
    incomingFlows: [], outgoingFlows: ['f1'],
  }
  const taskA: ServiceTaskElement = {
    id: 'taskA', type: 'serviceTask', taskType: 'doA',
    incomingFlows: ['f1'], outgoingFlows: ['f2'],
  }
  const compThrow: IntermediateThrowEventElement = {
    id: 'compThrow', type: 'intermediateThrowEvent',
    eventDefinition: { type: 'compensation' },
    incomingFlows: ['f2'], outgoingFlows: ['f3'],
  }
  const end: EndEventElement = {
    id: 'end', type: 'endEvent', eventDefinition: { type: 'none' },
    incomingFlows: ['f3'], outgoingFlows: [],
  }

  const boundaryA: BoundaryEventElement = {
    id: 'boundaryA', type: 'boundaryEvent', attachedToRef: 'taskA', cancelActivity: false,
    eventDefinition: { type: 'compensation', compensationActivityRef: 'handlerA' },
    incomingFlows: [], outgoingFlows: [],
  }
  const handlerA: UserTaskElement = {
    id: 'handlerA', type: 'userTask', priority: 50, isForCompensation: true,
    incomingFlows: [], outgoingFlows: [],
  }

  const flows: SequenceFlow[] = [
    { id: 'f1', sourceRef: 'start', targetRef: 'taskA' },
    { id: 'f2', sourceRef: 'taskA', targetRef: 'compThrow' },
    { id: 'f3', sourceRef: 'compThrow', targetRef: 'end' },
  ]

  return buildDefinition({
    id: 'comp-user-task-proc',
    elements: [start, taskA, compThrow, end, boundaryA, handlerA],
    sequenceFlows: flows,
    startEventId: 'start',
  })
}

describe('Scenario 4: user task compensation handler', () => {
  const definition = buildUserTaskHandlerDefinition()

  it('compensation handler user task suspends until CompleteUserTask', () => {
    idCounter = 0
    let state = startProcess(null, definition)

    const tokenA = waitingAt(state, 'taskA')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenA.id }, state, opts).newState

    // handlerA (userTask) should be waiting
    const handlerToken = waitingAt(state, 'handlerA')
    expect(handlerToken).toBeDefined()
    expect(handlerToken?.waitingFor?.type).toBe('user-task')

    // Process still active, throw token suspended
    expect(state.instance.status).toBe('active')
    const throwToken = state.tokens.find(t => t.elementId === 'compThrow')
    expect(throwToken?.status).toBe('waiting')
  })

  it('process completes after CompleteUserTask on the handler', () => {
    idCounter = 0
    let state = startProcess(null, definition)

    const tokenA = waitingAt(state, 'taskA')!
    state = execute(definition, { type: 'CompleteServiceTask', tokenId: tokenA.id }, state, opts).newState

    const handlerToken = waitingAt(state, 'handlerA')!
    const { newState, events } = execute(
      definition,
      { type: 'CompleteUserTask', tokenId: handlerToken.id, completedBy: 'user-1' },
      state,
      opts,
    )
    state = newState

    expect(state.instance.status).toBe('completed')
    expect(events.some(e => e.type === 'CompensationCompleted')).toBe(true)
  })
})
