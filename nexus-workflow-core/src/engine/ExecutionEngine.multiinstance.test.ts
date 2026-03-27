import { describe, it, expect, beforeEach } from 'vitest'
import { RuntimeError } from '../model/errors.js'
import { buildDefinition } from '../../tests/fixtures/builders/ProcessDefinitionBuilder.js'
import type {
  BpmnFlowElement,
  SequenceFlow,
  StartEventElement,
  EndEventElement,
  ServiceTaskElement,
  UserTaskElement,
  MultiInstanceLoopCharacteristics,
} from '../model/types.js'
import { execute, type EngineState, type EngineCommand } from './ExecutionEngine.js'

// ─── Test helpers ─────────────────────────────────────────────────────────────

let idCounter: number
const generateId = () => `id-${++idCounter}`
const options = { generateId }

function runCommands(
  def: ReturnType<typeof buildDefinition>,
  commands: EngineCommand[],
  initial: EngineState | null = null,
): { finalState: EngineState; allEvents: ReturnType<typeof execute>['events'] } {
  let state = initial
  const allEvents: ReturnType<typeof execute>['events'] = []
  for (const command of commands) {
    const result = execute(def, command, state, options)
    state = result.newState
    allEvents.push(...result.events)
  }
  return { finalState: state!, allEvents }
}

/**
 * Start → ServiceTask (parallel MI over `items`) → End
 */
function buildParallelMIServiceTaskDef(lc: MultiInstanceLoopCharacteristics) {
  const start: StartEventElement = {
    id: 'start_1', type: 'startEvent', eventDefinition: { type: 'none' },
    incomingFlows: [], outgoingFlows: ['flow_1'],
  }
  const task: ServiceTaskElement = {
    id: 'task_1', type: 'serviceTask', taskType: 'test',
    incomingFlows: ['flow_1'], outgoingFlows: ['flow_2'],
    loopCharacteristics: lc,
  }
  const end: EndEventElement = {
    id: 'end_1', type: 'endEvent', eventDefinition: { type: 'none' },
    incomingFlows: ['flow_2'], outgoingFlows: [],
  }
  const elements: BpmnFlowElement[] = [start, task, end]
  const sequenceFlows: SequenceFlow[] = [
    { id: 'flow_1', sourceRef: 'start_1', targetRef: 'task_1' },
    { id: 'flow_2', sourceRef: 'task_1', targetRef: 'end_1' },
  ]
  return buildDefinition({ elements, sequenceFlows, startEventId: 'start_1' })
}

/**
 * Start → UserTask (sequential MI over `items`) → End
 */
function buildSequentialMIUserTaskDef(lc: MultiInstanceLoopCharacteristics) {
  const start: StartEventElement = {
    id: 'start_1', type: 'startEvent', eventDefinition: { type: 'none' },
    incomingFlows: [], outgoingFlows: ['flow_1'],
  }
  const task: UserTaskElement = {
    id: 'task_1', type: 'userTask', name: 'Review', priority: 50,
    incomingFlows: ['flow_1'], outgoingFlows: ['flow_2'],
    loopCharacteristics: lc,
  }
  const end: EndEventElement = {
    id: 'end_1', type: 'endEvent', eventDefinition: { type: 'none' },
    incomingFlows: ['flow_2'], outgoingFlows: [],
  }
  const elements: BpmnFlowElement[] = [start, task, end]
  const sequenceFlows: SequenceFlow[] = [
    { id: 'flow_1', sourceRef: 'start_1', targetRef: 'task_1' },
    { id: 'flow_2', sourceRef: 'task_1', targetRef: 'end_1' },
  ]
  return buildDefinition({ elements, sequenceFlows, startEventId: 'start_1' })
}

// ─── Parallel Multi-Instance ──────────────────────────────────────────────────

describe('ExecutionEngine — Parallel Multi-Instance ServiceTask', () => {
  beforeEach(() => { idCounter = 0 })

  it('spawns N child tokens for a 3-item collection', () => {
    const def = buildParallelMIServiceTaskDef({
      isSequential: false,
      inputCollection: 'items',
      inputElement: 'item',
    })

    const { newState } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: ['a', 'b', 'c'] } },
      },
      null,
      options,
    )

    // 3 child tokens waiting at task_1 + 1 parent token (waiting)
    const atTask = newState.tokens.filter(t => t.elementId === 'task_1')
    expect(atTask).toHaveLength(4) // 1 parent + 3 children
    const waiting = atTask.filter(t => t.status === 'waiting')
    expect(waiting).toHaveLength(4) // parent + all 3 children waiting

    const children = atTask.filter(t => t.parentTokenId !== undefined)
    expect(children).toHaveLength(3)
  })

  it('emits MultiInstanceStarted with correct count', () => {
    const def = buildParallelMIServiceTaskDef({
      isSequential: false,
      inputCollection: 'items',
      inputElement: 'item',
    })

    const { events } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: ['a', 'b', 'c'] } },
      },
      null,
      options,
    )

    const miStarted = events.find(e => e.type === 'MultiInstanceStarted')
    expect(miStarted).toBeDefined()
    expect(miStarted).toMatchObject({ type: 'MultiInstanceStarted', count: 3, isSequential: false, elementId: 'task_1' })
  })

  it('sets the inputElement variable in each child scope', () => {
    const def = buildParallelMIServiceTaskDef({
      isSequential: false,
      inputCollection: 'items',
      inputElement: 'item',
    })

    const { newState } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: ['a', 'b', 'c'] } },
      },
      null,
      options,
    )

    const children = newState.tokens.filter(t => t.parentTokenId !== undefined)
    const childItems = children.map(child => {
      const scope = newState.scopes.find(s => s.id === child.scopeId)
      return scope?.variables['item']?.value
    })
    expect(childItems.sort()).toEqual(['a', 'b', 'c'])
  })

  it('advances parent token to end when all 3 children complete', () => {
    const def = buildParallelMIServiceTaskDef({
      isSequential: false,
      inputCollection: 'items',
      inputElement: 'item',
    })

    const { newState: afterStart } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: ['a', 'b', 'c'] } },
      },
      null,
      options,
    )

    const children = afterStart.tokens.filter(t => t.parentTokenId !== undefined)
    expect(children).toHaveLength(3)

    // Complete children one by one
    const { finalState, allEvents } = runCommands(
      def,
      children.map(c => ({ type: 'CompleteServiceTask' as const, tokenId: c.id })),
      afterStart,
    )

    expect(finalState.instance.status).toBe('completed')
    const miCompleted = allEvents.find(e => e.type === 'MultiInstanceCompleted')
    expect(miCompleted).toBeDefined()
    expect(miCompleted).toMatchObject({ type: 'MultiInstanceCompleted', iterationsRan: 3, elementId: 'task_1' })
  })

  it('collects output into outputCollection', () => {
    const def = buildParallelMIServiceTaskDef({
      isSequential: false,
      inputCollection: 'items',
      inputElement: 'item',
      outputElement: 'result',
      outputCollection: 'results',
    })

    const { newState: afterStart } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: ['a', 'b', 'c'] } },
      },
      null,
      options,
    )

    const children = afterStart.tokens.filter(t => t.parentTokenId !== undefined)

    // Complete each child with a result output
    const { finalState } = runCommands(
      def,
      children.map((c, i) => ({
        type: 'CompleteServiceTask' as const,
        tokenId: c.id,
        outputVariables: { result: { type: 'string', value: `result-${i}` } },
      })),
      afterStart,
    )

    const rootScope = finalState.scopes.find(s => s.id === finalState.instance.rootScopeId)
    const results = rootScope?.variables['results']?.value
    expect(Array.isArray(results)).toBe(true)
    expect((results as string[]).length).toBe(3)
  })

  it('emits MultiInstanceCompleted with iterationsRan equal to completed children', () => {
    const def = buildParallelMIServiceTaskDef({
      isSequential: false,
      inputCollection: 'items',
      inputElement: 'item',
    })

    const { newState: afterStart } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: ['x', 'y', 'z'] } },
      },
      null,
      options,
    )

    const children = afterStart.tokens.filter(t => t.parentTokenId !== undefined)
    const { allEvents } = runCommands(
      def,
      children.map(c => ({ type: 'CompleteServiceTask' as const, tokenId: c.id })),
      afterStart,
    )

    const miCompleted = allEvents.find(e => e.type === 'MultiInstanceCompleted')
    expect(miCompleted).toMatchObject({ iterationsRan: 3 })
  })

  it('throws RuntimeError when inputCollection does not resolve to an array', () => {
    const def = buildParallelMIServiceTaskDef({
      isSequential: false,
      inputCollection: 'notAnArray',
      inputElement: 'item',
    })

    expect(() =>
      execute(
        def,
        {
          type: 'StartProcess',
          variables: { notAnArray: { type: 'string', value: 'hello' } },
        },
        null,
        options,
      ),
    ).toThrow(RuntimeError)
  })
})

// ─── Parallel Multi-Instance — Completion Condition ───────────────────────────

describe('ExecutionEngine — Parallel MI completionCondition', () => {
  beforeEach(() => { idCounter = 0 })

  it('cancels remaining siblings when completionCondition triggers', () => {
    const def = buildParallelMIServiceTaskDef({
      isSequential: false,
      inputCollection: 'items',
      inputElement: 'item',
      completionCondition: 'done === true',
    })

    const { newState: afterStart } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: [1, 2, 3, 4, 5] }, done: { type: 'boolean', value: false } },
      },
      null,
      options,
    )

    const children = afterStart.tokens.filter(t => t.parentTokenId !== undefined)
    expect(children).toHaveLength(5)

    // Complete first child (condition still false)
    const { newState: after1, events: events1 } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: children[0]!.id },
      afterStart,
      options,
    )
    expect(events1.find(e => e.type === 'MultiInstanceCompleted')).toBeUndefined()

    // Complete second child with condition becoming true
    const { newState: after2, events: events2 } = execute(
      def,
      {
        type: 'CompleteServiceTask',
        tokenId: children[1]!.id,
        outputVariables: { done: { type: 'boolean', value: true } },
      },
      after1,
      options,
    )

    // Remaining 3 siblings should be cancelled
    const cancelled = after2.tokens.filter(t => t.status === 'cancelled' && t.parentTokenId !== undefined)
    expect(cancelled.length).toBeGreaterThanOrEqual(3)

    expect(events2.find(e => e.type === 'MultiInstanceCompleted')).toBeDefined()
    expect(after2.instance.status).toBe('completed')
  })
})

// ─── Sequential Multi-Instance ────────────────────────────────────────────────

describe('ExecutionEngine — Sequential Multi-Instance UserTask', () => {
  beforeEach(() => { idCounter = 0 })

  it('spawns only 1 child token initially for a 3-item collection', () => {
    const def = buildSequentialMIUserTaskDef({
      isSequential: true,
      inputCollection: 'items',
      inputElement: 'item',
    })

    const { newState } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: ['a', 'b', 'c'] } },
      },
      null,
      options,
    )

    const children = newState.tokens.filter(t => t.parentTokenId !== undefined)
    expect(children).toHaveLength(1)
  })

  it('emits MultiInstanceStarted with full count even in sequential mode', () => {
    const def = buildSequentialMIUserTaskDef({
      isSequential: true,
      inputCollection: 'items',
      inputElement: 'item',
    })

    const { events } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: ['a', 'b', 'c'] } },
      },
      null,
      options,
    )

    const miStarted = events.find(e => e.type === 'MultiInstanceStarted')
    expect(miStarted).toMatchObject({ count: 3, isSequential: true })
  })

  it('processes 3 items sequentially and completes after the third', () => {
    const def = buildSequentialMIUserTaskDef({
      isSequential: true,
      inputCollection: 'items',
      inputElement: 'item',
    })

    const { newState: s0 } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: ['a', 'b', 'c'] } },
      },
      null,
      options,
    )

    // First child
    const child0 = s0.tokens.find(t => t.parentTokenId !== undefined)!
    const { newState: s1 } = execute(def, { type: 'CompleteUserTask', tokenId: child0.id, completedBy: 'user1' }, s0, options)

    // Second child spawned
    const child1 = s1.tokens.find(t => t.parentTokenId !== undefined && t.status === 'waiting')!
    expect(child1).toBeDefined()
    const { newState: s2 } = execute(def, { type: 'CompleteUserTask', tokenId: child1.id, completedBy: 'user2' }, s1, options)

    // Third child spawned
    const child2 = s2.tokens.find(t => t.parentTokenId !== undefined && t.status === 'waiting')!
    expect(child2).toBeDefined()
    const { newState: s3, events: events3 } = execute(def, { type: 'CompleteUserTask', tokenId: child2.id, completedBy: 'user3' }, s2, options)

    expect(s3.instance.status).toBe('completed')
    const miCompleted = events3.find(e => e.type === 'MultiInstanceCompleted')
    expect(miCompleted).toMatchObject({ iterationsRan: 3 })
  })

  it('stops early when completionCondition is satisfied in sequential mode', () => {
    const def = buildSequentialMIUserTaskDef({
      isSequential: true,
      inputCollection: 'items',
      inputElement: 'item',
      completionCondition: 'approved === true',
    })

    const { newState: s0 } = execute(
      def,
      {
        type: 'StartProcess',
        variables: {
          items: { type: 'array', value: ['a', 'b', 'c'] },
          approved: { type: 'boolean', value: false },
        },
      },
      null,
      options,
    )

    const child0 = s0.tokens.find(t => t.parentTokenId !== undefined)!
    // Complete child0 with approved = true — should end the loop early
    const { newState: s1, events: events1 } = execute(
      def,
      {
        type: 'CompleteUserTask',
        tokenId: child0.id,
        completedBy: 'user1',
        outputVariables: { approved: { type: 'boolean', value: true } },
      },
      s0,
      options,
    )

    expect(s1.instance.status).toBe('completed')
    const miCompleted = events1.find(e => e.type === 'MultiInstanceCompleted')
    expect(miCompleted).toMatchObject({ iterationsRan: 1 })
  })
})

// ─── Empty Collection ─────────────────────────────────────────────────────────

describe('ExecutionEngine — Multi-Instance empty collection', () => {
  beforeEach(() => { idCounter = 0 })

  it('skips the task and emits MultiInstanceCompleted with iterationsRan: 0', () => {
    const def = buildParallelMIServiceTaskDef({
      isSequential: false,
      inputCollection: 'items',
      inputElement: 'item',
    })

    const { newState, events } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: [] } },
      },
      null,
      options,
    )

    expect(newState.instance.status).toBe('completed')

    const miCompleted = events.find(e => e.type === 'MultiInstanceCompleted')
    expect(miCompleted).toMatchObject({ iterationsRan: 0, elementId: 'task_1' })

    // No child tokens should have been spawned
    const children = newState.tokens.filter(t => t.parentTokenId !== undefined)
    expect(children).toHaveLength(0)
  })

  it('skips the task for sequential MI with empty collection', () => {
    const def = buildSequentialMIUserTaskDef({
      isSequential: true,
      inputCollection: 'items',
      inputElement: 'item',
    })

    const { newState, events } = execute(
      def,
      {
        type: 'StartProcess',
        variables: { items: { type: 'array', value: [] } },
      },
      null,
      options,
    )

    expect(newState.instance.status).toBe('completed')
    expect(events.find(e => e.type === 'MultiInstanceCompleted')).toBeDefined()
    expect(events.find(e => e.type === 'MultiInstanceStarted')).toBeUndefined()
  })
})
