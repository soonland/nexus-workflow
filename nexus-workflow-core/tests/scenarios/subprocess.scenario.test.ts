/**
 * Sub-Process & Transaction — Scenario Tests
 *
 * Scenario 1 — embedded sub-process happy path:
 *   [Start] → [SubProcess: TaskA → TaskB → InnerEnd] → [End]
 *   Both service tasks inside complete normally; outer process ends.
 *
 * Scenario 2 — transaction happy path:
 *   Same structure with isTransaction: true — behaves identically on happy path.
 *
 * Scenario 3 — transaction cancel path:
 *   [Start] → [Transaction: TaskA → CancelEnd] → [CancelBoundary] → [End]
 *   TaskA completes (records compensation), cancel end fires, compensation handler
 *   runs, cancel boundary advances the outer process.
 */

import { describe, it, expect } from 'vitest'
import { execute, type EngineState } from '../../src/engine/ExecutionEngine.js'
import { buildDefinition } from '../fixtures/builders/ProcessDefinitionBuilder.js'
import type {
  StartEventElement,
  EndEventElement,
  ServiceTaskElement,
  BoundaryEventElement,
  SubProcessElement,
  SequenceFlow,
} from '../../src/model/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

let idCounter = 0
const opts = { generateId: () => `id-${++idCounter}`, now: () => new Date(1000 * ++idCounter) }

function startProcess(
  definition: ReturnType<typeof buildDefinition>,
  state: EngineState | null = null,
): EngineState {
  return execute(definition, { type: 'StartProcess' }, state, opts).newState
}

function waitingAt(state: EngineState, elementId: string) {
  return state.tokens.find(t => t.elementId === elementId && t.status === 'waiting')
}

function complete(tokenId: string, definition: ReturnType<typeof buildDefinition>, state: EngineState) {
  return execute(definition, { type: 'CompleteServiceTask', tokenId }, state, opts).newState
}

// ─── Scenario 1: Embedded sub-process — happy path ───────────────────────────

/**
 * Process:
 *   [Start] --f1--> [SubProc] --f2--> [End]
 *
 *   Inside SubProc:
 *     [InnerStart] --if1--> [TaskA: service] --if2--> [TaskB: service] --if3--> [InnerEnd]
 */

function buildEmbeddedSubProcessDefinition(isTransaction = false) {
  const innerStart: StartEventElement = {
    id: 'inner-start', type: 'startEvent', eventDefinition: { type: 'none' },
    incomingFlows: [], outgoingFlows: ['if1'],
  }
  const taskA: ServiceTaskElement = {
    id: 'taskA', type: 'serviceTask', taskType: 'doA',
    incomingFlows: ['if1'], outgoingFlows: ['if2'],
  }
  const taskB: ServiceTaskElement = {
    id: 'taskB', type: 'serviceTask', taskType: 'doB',
    incomingFlows: ['if2'], outgoingFlows: ['if3'],
  }
  const innerEnd: EndEventElement = {
    id: 'inner-end', type: 'endEvent', eventDefinition: { type: 'none' },
    incomingFlows: ['if3'], outgoingFlows: [],
  }
  const innerFlows: SequenceFlow[] = [
    { id: 'if1', sourceRef: 'inner-start', targetRef: 'taskA' },
    { id: 'if2', sourceRef: 'taskA', targetRef: 'taskB' },
    { id: 'if3', sourceRef: 'taskB', targetRef: 'inner-end' },
  ]

  const subProc: SubProcessElement = {
    id: 'sub1', type: 'subProcess',
    ...(isTransaction ? { isTransaction: true } : {}),
    elements: [innerStart, taskA, taskB, innerEnd],
    sequenceFlows: innerFlows,
    startEventId: 'inner-start',
    incomingFlows: ['f1'], outgoingFlows: ['f2'],
  }

  const start: StartEventElement = {
    id: 'start', type: 'startEvent', eventDefinition: { type: 'none' },
    incomingFlows: [], outgoingFlows: ['f1'],
  }
  const end: EndEventElement = {
    id: 'end', type: 'endEvent', eventDefinition: { type: 'none' },
    incomingFlows: ['f2'], outgoingFlows: [],
  }

  return buildDefinition({
    elements: [start, subProc, end],
    sequenceFlows: [
      { id: 'f1', sourceRef: 'start', targetRef: 'sub1' },
      { id: 'f2', sourceRef: 'sub1', targetRef: 'end' },
    ],
    startEventId: 'start',
  })
}

describe('Scenario 1 — embedded sub-process happy path', () => {
  it('enters the sub-process and suspends the outer token', () => {
    const def = buildEmbeddedSubProcessDefinition()
    const state = startProcess(def)

    // Outer sub-process token should be waiting
    expect(waitingAt(state, 'sub1')).toBeDefined()
    // Inner start should have advanced to taskA waiting
    expect(waitingAt(state, 'taskA')).toBeDefined()
  })

  it('emits SubProcessStarted when the sub-process is entered', () => {
    const def = buildEmbeddedSubProcessDefinition()
    const { events } = execute(def, { type: 'StartProcess' }, null, opts)
    expect(events.find(e => e.type === 'SubProcessStarted' && e.elementId === 'sub1')).toBeDefined()
  })

  it('inner tokens carry the subProcessInstanceId', () => {
    const def = buildEmbeddedSubProcessDefinition()
    const state = startProcess(def)
    const innerToken = waitingAt(state, 'taskA')
    expect(innerToken?.subProcessInstanceId).toBe('sub1')
  })

  it('completes inner tasks sequentially', () => {
    const def = buildEmbeddedSubProcessDefinition()
    let state = startProcess(def)

    const tokenA = waitingAt(state, 'taskA')!
    state = complete(tokenA.id, def, state)

    // taskA done, taskB now waiting
    expect(waitingAt(state, 'taskB')).toBeDefined()
    expect(waitingAt(state, 'taskA')).toBeUndefined()
  })

  it('completes the instance after both inner tasks finish', () => {
    const def = buildEmbeddedSubProcessDefinition()
    let state = startProcess(def)

    state = complete(waitingAt(state, 'taskA')!.id, def, state)
    state = complete(waitingAt(state, 'taskB')!.id, def, state)

    expect(state.instance.status).toBe('completed')
  })

  it('emits SubProcessCompleted before outer token advances', () => {
    const def = buildEmbeddedSubProcessDefinition()
    let state = startProcess(def)
    state = complete(waitingAt(state, 'taskA')!.id, def, state)
    const { events } = execute(def, { type: 'CompleteServiceTask', tokenId: waitingAt(state, 'taskB')!.id }, state, opts)

    expect(events.find(e => e.type === 'SubProcessCompleted' && e.elementId === 'sub1')).toBeDefined()
    expect(events.find(e => e.type === 'ProcessInstanceCompleted')).toBeDefined()
  })
})

// ─── Scenario 2: Transaction — happy path ─────────────────────────────────────

describe('Scenario 2 — transaction sub-process happy path', () => {
  it('behaves identically to an embedded sub-process on the happy path', () => {
    const def = buildEmbeddedSubProcessDefinition(true)
    let state = startProcess(def)

    expect(waitingAt(state, 'sub1')).toBeDefined()
    expect(waitingAt(state, 'taskA')).toBeDefined()

    state = complete(waitingAt(state, 'taskA')!.id, def, state)
    state = complete(waitingAt(state, 'taskB')!.id, def, state)

    expect(state.instance.status).toBe('completed')
  })
})

// ─── Scenario 3: Transaction — cancel path ────────────────────────────────────

/**
 * Process:
 *   [Start] --f1--> [Transaction] --f2(cancel boundary)--> [End]
 *
 *   Inside Transaction:
 *     [InnerStart] --if1--> [TaskA: service] --if2--> [CancelEnd]
 *
 *   TaskA has a compensation boundary → CompHandler (service, isForCompensation)
 *   Transaction has a cancel boundary event → routes to [End]
 */

function buildTransactionCancelDefinition() {
  const innerStart: StartEventElement = {
    id: 'inner-start', type: 'startEvent', eventDefinition: { type: 'none' },
    incomingFlows: [], outgoingFlows: ['if1'],
  }
  const taskA: ServiceTaskElement = {
    id: 'taskA', type: 'serviceTask', taskType: 'doA',
    incomingFlows: ['if1'], outgoingFlows: ['if2'],
  }
  const cancelEnd: EndEventElement = {
    id: 'cancel-end', type: 'endEvent', eventDefinition: { type: 'cancel' },
    incomingFlows: ['if2'], outgoingFlows: [],
  }
  const compBoundary: BoundaryEventElement = {
    id: 'comp-boundary', type: 'boundaryEvent', attachedToRef: 'taskA', cancelActivity: false,
    eventDefinition: { type: 'compensation', compensationActivityRef: 'compHandler' },
    incomingFlows: [], outgoingFlows: [],
  }
  const compHandler: ServiceTaskElement = {
    id: 'compHandler', type: 'serviceTask', taskType: 'undoA', isForCompensation: true,
    incomingFlows: [], outgoingFlows: [],
  }
  const innerFlows: SequenceFlow[] = [
    { id: 'if1', sourceRef: 'inner-start', targetRef: 'taskA' },
    { id: 'if2', sourceRef: 'taskA', targetRef: 'cancel-end' },
  ]

  const cancelBoundary: BoundaryEventElement = {
    id: 'cancel-boundary', type: 'boundaryEvent', attachedToRef: 'txn1', cancelActivity: true,
    eventDefinition: { type: 'cancel' },
    incomingFlows: [], outgoingFlows: ['f2'],
  }

  const txn: SubProcessElement = {
    id: 'txn1', type: 'subProcess', isTransaction: true,
    elements: [innerStart, taskA, cancelEnd, compBoundary, compHandler],
    sequenceFlows: innerFlows,
    startEventId: 'inner-start',
    incomingFlows: ['f1'], outgoingFlows: [],
  }

  const start: StartEventElement = {
    id: 'start', type: 'startEvent', eventDefinition: { type: 'none' },
    incomingFlows: [], outgoingFlows: ['f1'],
  }
  const end: EndEventElement = {
    id: 'end', type: 'endEvent', eventDefinition: { type: 'none' },
    incomingFlows: ['f2'], outgoingFlows: [],
  }

  return buildDefinition({
    elements: [start, txn, cancelBoundary, end],
    sequenceFlows: [
      { id: 'f1', sourceRef: 'start', targetRef: 'txn1' },
      { id: 'f2', sourceRef: 'cancel-boundary', targetRef: 'end' },
    ],
    startEventId: 'start',
  })
}

describe('Scenario 3 — transaction cancel path', () => {
  it('enters the transaction and waits at inner taskA', () => {
    const def = buildTransactionCancelDefinition()
    const state = startProcess(def)

    expect(waitingAt(state, 'txn1')).toBeDefined()
    expect(waitingAt(state, 'taskA')).toBeDefined()
  })

  it('includes taskA in compensatedActivities on TransactionCancelled', () => {
    const def = buildTransactionCancelDefinition()
    const initialState = startProcess(def)
    const { events } = execute(def, { type: 'CompleteServiceTask', tokenId: waitingAt(initialState, 'taskA')!.id }, initialState, opts)

    const cancelled = events.find(e => e.type === 'TransactionCancelled') as Extract<typeof events[number], { type: 'TransactionCancelled' }> | undefined
    expect(cancelled?.compensatedActivities).toContain('taskA')
  })

  it('emits TransactionCancelled when cancel end event fires', () => {
    const def = buildTransactionCancelDefinition()
    const state = startProcess(def)
    const { events } = execute(def, { type: 'CompleteServiceTask', tokenId: waitingAt(state, 'taskA')!.id }, state, opts)

    const cancelled = events.find(e => e.type === 'TransactionCancelled')
    expect(cancelled).toBeDefined()
    expect((cancelled as Extract<typeof cancelled, { type: 'TransactionCancelled' }>)?.compensatedActivities).toContain('taskA')
  })

  it('spawns a compensation handler token after cancel', () => {
    const def = buildTransactionCancelDefinition()
    let state = startProcess(def)
    state = complete(waitingAt(state, 'taskA')!.id, def, state)

    // compHandler should be active/waiting (it's a service task → waiting)
    const handlerToken = state.tokens.find(t => t.elementId === 'compHandler' && t.status === 'waiting')
    expect(handlerToken).toBeDefined()
  })

  it('fires the cancel boundary and completes the instance after compensation', () => {
    const def = buildTransactionCancelDefinition()
    let state = startProcess(def)

    // Complete taskA → triggers cancel end → starts compensation handler
    state = complete(waitingAt(state, 'taskA')!.id, def, state)

    // Complete the compensation handler
    const handlerToken = state.tokens.find(t => t.elementId === 'compHandler' && t.status === 'waiting')!
    const { newState, events } = execute(def, { type: 'CompleteServiceTask', tokenId: handlerToken.id }, state, opts)

    expect(events.find(e => e.type === 'BoundaryEventTriggered')).toBeDefined()
    expect(events.find(e => e.type === 'ProcessInstanceCompleted')).toBeDefined()
    expect(newState.instance.status).toBe('completed')
  })

  it('compensation records are consumed when cancel fires (none remain in state)', () => {
    const def = buildTransactionCancelDefinition()
    let state = startProcess(def)
    state = complete(waitingAt(state, 'taskA')!.id, def, state)

    // Records are consumed synchronously by handleTransactionCancel
    expect(state.compensationRecords).toHaveLength(0)
  })

  it('emits CompensationCompleted before firing cancel boundary', () => {
    const def = buildTransactionCancelDefinition()
    let state = startProcess(def)
    state = complete(waitingAt(state, 'taskA')!.id, def, state)

    const handlerToken = state.tokens.find(t => t.elementId === 'compHandler' && t.status === 'waiting')!
    const { events } = execute(def, { type: 'CompleteServiceTask', tokenId: handlerToken.id }, state, opts)

    const compCompleted = events.findIndex(e => e.type === 'CompensationCompleted')
    const boundaryTriggered = events.findIndex(e => e.type === 'BoundaryEventTriggered')
    expect(compCompleted).toBeGreaterThanOrEqual(0)
    expect(boundaryTriggered).toBeGreaterThan(compCompleted)
  })
})
