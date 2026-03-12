import { describe, it, expect, beforeEach } from 'vitest'
import { execute } from './ExecutionEngine.js'
import type { EngineState, EngineCommand } from './ExecutionEngine.js'
import { RuntimeError, DefinitionError } from '../model/errors.js'
import {
  buildDefinition,
  buildSimpleSequenceDefinition,
  buildServiceTaskDefinition,
  buildUserTaskDefinition,
  buildXorGatewayDefinition,
  buildParallelGatewayDefinition,
} from '../../tests/fixtures/builders/ProcessDefinitionBuilder.js'
import type { BpmnFlowElement, SequenceFlow, StartEventElement, EndEventElement, ManualTaskElement, ScriptTaskElement, ServiceTaskElement } from '../model/types.js'

// ─── Test helpers ─────────────────────────────────────────────────────────────

let idCounter: number
const generateId = () => `id-${++idCounter}`
const options = { generateId }

/** Chain multiple commands through the engine, accumulating state. */
function runCommands(
  def: ReturnType<typeof buildSimpleSequenceDefinition>,
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

// ─── StartProcess ─────────────────────────────────────────────────────────────

describe('ExecutionEngine — StartProcess', () => {
  beforeEach(() => { idCounter = 0 })

  it('runs a simple Start → End process to completion in one command', () => {
    const def = buildSimpleSequenceDefinition()

    const { newState, events } = execute(def, { type: 'StartProcess' }, null, options)

    expect(newState.instance.status).toBe('completed')
    expect(newState.tokens.every(t => t.status === 'completed')).toBe(true)
    expect(events.map(e => e.type)).toContain('ProcessInstanceStarted')
    expect(events.map(e => e.type)).toContain('ProcessInstanceCompleted')
  })

  it('emits ProcessInstanceStarted before ProcessInstanceCompleted', () => {
    const def = buildSimpleSequenceDefinition()

    const { events } = execute(def, { type: 'StartProcess' }, null, options)

    const types = events.map(e => e.type)
    expect(types.indexOf('ProcessInstanceStarted')).toBeLessThan(
      types.indexOf('ProcessInstanceCompleted'),
    )
  })

  it('creates a root variable scope', () => {
    const def = buildSimpleSequenceDefinition()

    const { newState } = execute(def, { type: 'StartProcess' }, null, options)

    expect(newState.scopes.length).toBeGreaterThanOrEqual(1)
  })

  it('merges input variables into the root scope', () => {
    const def = buildSimpleSequenceDefinition()

    const { newState } = execute(
      def,
      { type: 'StartProcess', variables: { amount: { type: 'number', value: 500 } } },
      null,
      options,
    )

    const rootScope = newState.scopes.find(s => s.id === newState.instance.rootScopeId)
    expect(rootScope?.variables['amount']?.value).toBe(500)
  })

  it('stores the correlationKey on the instance', () => {
    const def = buildSimpleSequenceDefinition()

    const { newState } = execute(
      def,
      { type: 'StartProcess', correlationKey: 'order-123' },
      null,
      options,
    )

    expect(newState.instance.correlationKey).toBe('order-123')
  })
})

// ─── ServiceTask suspend / resume ─────────────────────────────────────────────

describe('ExecutionEngine — ServiceTask', () => {
  beforeEach(() => { idCounter = 0 })

  it('suspends the token when a service task is reached', () => {
    const def = buildServiceTaskDefinition()

    const { newState } = execute(def, { type: 'StartProcess' }, null, options)

    const waiting = newState.tokens.filter(t => t.status === 'waiting')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]?.elementId).toBe('task_1')
    expect(newState.instance.status).toBe('active')
  })

  it('emits ServiceTaskStarted and TokenWaiting events on suspension', () => {
    const def = buildServiceTaskDefinition()

    const { events } = execute(def, { type: 'StartProcess' }, null, options)

    expect(events.map(e => e.type)).toContain('ServiceTaskStarted')
    expect(events.map(e => e.type)).toContain('TokenWaiting')
  })

  it('resumes on CompleteServiceTask and runs to completion', () => {
    const def = buildServiceTaskDefinition()
    const { newState: suspended } = execute(def, { type: 'StartProcess' }, null, options)

    const taskToken = suspended.tokens.find(t => t.status === 'waiting')!
    const { newState: completed } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      suspended,
      options,
    )

    expect(completed.instance.status).toBe('completed')
  })

  it('merges output variables into the scope after task completion', () => {
    const def = buildServiceTaskDefinition()
    const { newState: suspended } = execute(def, { type: 'StartProcess' }, null, options)

    const taskToken = suspended.tokens.find(t => t.status === 'waiting')!
    const { newState } = execute(
      def,
      {
        type: 'CompleteServiceTask',
        tokenId: taskToken.id,
        outputVariables: { result: { type: 'string', value: 'ok' } },
      },
      suspended,
      options,
    )

    const scope = newState.scopes.find(s => s.id === newState.instance.rootScopeId)
    expect(scope?.variables['result']?.value).toBe('ok')
  })

  it('emits ServiceTaskCompleted on successful completion', () => {
    const def = buildServiceTaskDefinition()
    const { newState: suspended } = execute(def, { type: 'StartProcess' }, null, options)

    const taskToken = suspended.tokens.find(t => t.status === 'waiting')!
    const { events } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      suspended,
      options,
    )

    expect(events.map(e => e.type)).toContain('ServiceTaskCompleted')
  })

  it('throws RuntimeError when completing a token that is not waiting', () => {
    const def = buildServiceTaskDefinition()
    const { newState: suspended } = execute(def, { type: 'StartProcess' }, null, options)

    const taskToken = suspended.tokens.find(t => t.status === 'waiting')!
    // Complete it once legitimately
    const { newState: completed } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      suspended,
      options,
    )

    // Try to complete it again
    expect(() =>
      execute(def, { type: 'CompleteServiceTask', tokenId: taskToken.id }, completed, options),
    ).toThrow(RuntimeError)
  })

  it('suspends the instance on FailServiceTask when no error boundary matches', () => {
    const def = buildServiceTaskDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    const taskToken = s0.tokens.find(t => t.status === 'waiting')!
    const { newState } = execute(
      def,
      {
        type: 'FailServiceTask',
        tokenId: taskToken.id,
        error: { code: 'TIMEOUT', message: 'Request timed out' },
      },
      s0,
      options,
    )

    expect(newState.instance.status).toBe('suspended')
    expect(newState.instance.errorInfo?.code).toBe('TIMEOUT')
  })
})

// ─── UserTask ─────────────────────────────────────────────────────────────────

describe('ExecutionEngine — UserTask', () => {
  beforeEach(() => { idCounter = 0 })

  it('suspends the token when a user task is reached', () => {
    const def = buildUserTaskDefinition()

    const { newState } = execute(def, { type: 'StartProcess' }, null, options)

    const waiting = newState.tokens.filter(t => t.status === 'waiting')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]?.waitingFor?.type).toBe('user-task')
  })

  it('resumes on CompleteUserTask and runs to completion', () => {
    const def = buildUserTaskDefinition()
    const { newState: suspended } = execute(def, { type: 'StartProcess' }, null, options)

    const taskToken = suspended.tokens.find(t => t.status === 'waiting')!
    const { newState } = execute(
      def,
      { type: 'CompleteUserTask', tokenId: taskToken.id, completedBy: 'user-1' },
      suspended,
      options,
    )

    expect(newState.instance.status).toBe('completed')
  })

  it('merges user task output variables into scope', () => {
    const def = buildUserTaskDefinition()
    const { newState: suspended } = execute(def, { type: 'StartProcess' }, null, options)

    const taskToken = suspended.tokens.find(t => t.status === 'waiting')!
    const { newState } = execute(
      def,
      {
        type: 'CompleteUserTask',
        tokenId: taskToken.id,
        completedBy: 'user-1',
        outputVariables: { approved: { type: 'boolean', value: true } },
      },
      suspended,
      options,
    )

    const scope = newState.scopes.find(s => s.id === newState.instance.rootScopeId)
    expect(scope?.variables['approved']?.value).toBe(true)
  })
})

// ─── XOR Gateway ─────────────────────────────────────────────────────────────

describe('ExecutionEngine — XOR Gateway', () => {
  beforeEach(() => { idCounter = 0 })

  it('routes to the high-value branch when amount > 100', () => {
    const def = buildXorGatewayDefinition()

    const { newState } = execute(
      def,
      { type: 'StartProcess', variables: { amount: { type: 'number', value: 500 } } },
      null,
      options,
    )

    // Should be suspended at task_a (high-value handler)
    const waiting = newState.tokens.find(t => t.status === 'waiting')
    expect(waiting?.elementId).toBe('task_a')
  })

  it('routes to the default branch when amount <= 100', () => {
    const def = buildXorGatewayDefinition()

    const { newState } = execute(
      def,
      { type: 'StartProcess', variables: { amount: { type: 'number', value: 50 } } },
      null,
      options,
    )

    const waiting = newState.tokens.find(t => t.status === 'waiting')
    expect(waiting?.elementId).toBe('task_b')
  })

  it('completes after the chosen branch task is done', () => {
    const def = buildXorGatewayDefinition()
    const { newState: suspended } = execute(
      def,
      { type: 'StartProcess', variables: { amount: { type: 'number', value: 500 } } },
      null,
      options,
    )

    const taskToken = suspended.tokens.find(t => t.status === 'waiting')!
    const { newState } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      suspended,
      options,
    )

    expect(newState.instance.status).toBe('completed')
  })
})

// ─── Parallel Gateway ─────────────────────────────────────────────────────────

describe('ExecutionEngine — Parallel Gateway', () => {
  beforeEach(() => { idCounter = 0 })

  it('activates all 3 branches simultaneously on split', () => {
    const def = buildParallelGatewayDefinition()

    const { newState } = execute(def, { type: 'StartProcess' }, null, options)

    const waiting = newState.tokens.filter(t => t.status === 'waiting')
    expect(waiting).toHaveLength(3)
    expect(waiting.map(t => t.elementId).sort()).toEqual(['task_a', 'task_b', 'task_c'])
  })

  it('does not complete after only 1 of 3 branches finishes', () => {
    const def = buildParallelGatewayDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    const tokA = s0.tokens.find(t => t.elementId === 'task_a')!
    const { newState: s1 } = execute(
      def, { type: 'CompleteServiceTask', tokenId: tokA.id }, s0, options,
    )

    expect(s1.instance.status).toBe('active')
    expect(s1.tokens.filter(t => t.status === 'waiting')).toHaveLength(2)
  })

  it('does not complete after 2 of 3 branches finish', () => {
    const def = buildParallelGatewayDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    const tokA = s0.tokens.find(t => t.elementId === 'task_a')!
    const { newState: s1 } = execute(def, { type: 'CompleteServiceTask', tokenId: tokA.id }, s0, options)

    const tokB = s1.tokens.find(t => t.elementId === 'task_b')!
    const { newState: s2 } = execute(def, { type: 'CompleteServiceTask', tokenId: tokB.id }, s1, options)

    expect(s2.instance.status).toBe('active')
    expect(s2.tokens.filter(t => t.status === 'waiting')).toHaveLength(1)
  })

  it('completes when the last branch finishes and the join fires', () => {
    const def = buildParallelGatewayDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    const { finalState } = runCommands(
      def,
      [
        { type: 'CompleteServiceTask', tokenId: s0.tokens.find(t => t.elementId === 'task_a')!.id },
        { type: 'CompleteServiceTask', tokenId: s0.tokens.find(t => t.elementId === 'task_b')!.id },
        { type: 'CompleteServiceTask', tokenId: s0.tokens.find(t => t.elementId === 'task_c')!.id },
      ],
      s0,
    )

    expect(finalState.instance.status).toBe('completed')
  })

  it('persists gateway join state between commands', () => {
    const def = buildParallelGatewayDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    const tokA = s0.tokens.find(t => t.elementId === 'task_a')!
    const { newState: s1 } = execute(def, { type: 'CompleteServiceTask', tokenId: tokA.id }, s0, options)

    expect(s1.gatewayJoinStates).toHaveLength(1)
    expect(s1.gatewayJoinStates[0]?.arrivedFromFlows).toHaveLength(1)
  })
})

// ─── DefinitionError paths ────────────────────────────────────────────────────
//
// getElement and getFlow throw DefinitionError for missing ids — these are
// defensive guards that protect against corrupted definitions or bad flow refs.

describe('ExecutionEngine — DefinitionError for missing elements/flows', () => {
  beforeEach(() => { idCounter = 0 })

  it('throws DefinitionError when the start event element id does not exist in elements', () => {
    const def = buildDefinition({
      startEventId: 'nonexistent-start',
      elements: [],
      sequenceFlows: [],
    })
    expect(() => execute(def, { type: 'StartProcess' }, null, options)).toThrow(DefinitionError)
  })

  it('throws DefinitionError when a sequence flow references a missing target element', () => {
    // Build a definition where the start event has an outgoing flow pointing at
    // a non-existent element — this triggers getElement inside moveTokenToFlow → getFlow → getElement
    const start: StartEventElement = {
      id: 'start_1',
      type: 'startEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: ['flow_bad'],
    }
    const badFlow: SequenceFlow = { id: 'flow_bad', sourceRef: 'start_1', targetRef: 'missing_element' }
    const def = buildDefinition({
      elements: [start],
      sequenceFlows: [badFlow],
      startEventId: 'start_1',
    })
    expect(() => execute(def, { type: 'StartProcess' }, null, options)).toThrow(DefinitionError)
  })

  it('throws DefinitionError when CompleteServiceTask references a token whose element is missing', () => {
    // Start a valid process to get a waiting token, then surgically remove the element from the
    // definition to trigger getElement failure during handleCompleteTask → advanceToken → getOutgoingFlows
    const def = buildServiceTaskDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)
    const taskToken = s0.tokens.find(t => t.status === 'waiting')!

    // Remove all elements so getElement fails for the task element
    const corruptDef = { ...def, elements: [] }
    expect(() =>
      execute(corruptDef, { type: 'CompleteServiceTask', tokenId: taskToken.id }, s0, options)
    ).toThrow(DefinitionError)
  })

  it('throws DefinitionError when a flow id in outgoingFlows does not exist in sequenceFlows (getFlow path)', () => {
    // Build a start element whose outgoingFlows lists a flow id not present in sequenceFlows,
    // triggering the getFlow DefinitionError at line 881.
    const start: StartEventElement = {
      id: 'start_1',
      type: 'startEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: ['flow_nonexistent'],
    }
    const end: EndEventElement = {
      id: 'end_1',
      type: 'endEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: [],
    }
    // sequenceFlows is intentionally empty — 'flow_nonexistent' is not defined
    const def = buildDefinition({
      elements: [start, end],
      sequenceFlows: [],
      startEventId: 'start_1',
    })
    expect(() => execute(def, { type: 'StartProcess' }, null, options)).toThrow(DefinitionError)
  })
})

// ─── Inclusive Gateway (engine integration) ────────────────────────────────────
//
// This exercises findInclusiveJoinIncoming (lines 838–866) which is called when
// an inclusive gateway split pre-registers join state for downstream joins.

describe('ExecutionEngine — Inclusive Gateway split + join', () => {
  beforeEach(() => { idCounter = 0 })

  /**
   * Direct inclusive split→join where the split's outgoing flows ARE the join's incoming flows.
   * This is the topology that findInclusiveJoinIncoming can detect and pre-register.
   *
   * [Start] → [OR split] --flow_a (amount > 100)--> [OR join] → [End]
   *                       --flow_b (amount > 50) --> [OR join]
   *                       --flow_c (default)     --> [OR join]
   */
  function buildInclusiveGatewayDefinition(): ReturnType<typeof buildSimpleSequenceDefinition> {
    const elements: BpmnFlowElement[] = [
      {
        id: 'start_1', type: 'startEvent', eventDefinition: { type: 'none' },
        incomingFlows: [], outgoingFlows: ['flow_1'],
      } as StartEventElement,
      {
        id: 'gw_split', type: 'inclusiveGateway', defaultFlow: 'flow_c',
        incomingFlows: ['flow_1'], outgoingFlows: ['flow_a', 'flow_b', 'flow_c'],
      } as any,
      // No intermediate tasks — split flows connect DIRECTLY to the join so
      // findInclusiveJoinIncoming can match the activated flow IDs to join incoming IDs.
      {
        id: 'gw_join', type: 'inclusiveGateway',
        incomingFlows: ['flow_a', 'flow_b', 'flow_c'], outgoingFlows: ['flow_end'],
      } as any,
      {
        id: 'end_1', type: 'endEvent', eventDefinition: { type: 'none' },
        incomingFlows: ['flow_end'], outgoingFlows: [],
      } as EndEventElement,
    ]

    const sequenceFlows: SequenceFlow[] = [
      { id: 'flow_1',   sourceRef: 'start_1',  targetRef: 'gw_split' },
      { id: 'flow_a',   sourceRef: 'gw_split', targetRef: 'gw_join', conditionExpression: 'amount > 100' },
      { id: 'flow_b',   sourceRef: 'gw_split', targetRef: 'gw_join', conditionExpression: 'amount > 50' },
      { id: 'flow_c',   sourceRef: 'gw_split', targetRef: 'gw_join', isDefault: true },
      { id: 'flow_end', sourceRef: 'gw_join',  targetRef: 'end_1' },
    ]

    return buildDefinition({ elements, sequenceFlows, startEventId: 'start_1' })
  }

  /**
   * Split → service tasks → join: intermediate tasks between split and join.
   * Used to test completion of a multi-task inclusive gateway scenario.
   * The join state is supplied explicitly via the engine state (as would happen
   * in practice when the WorkflowEngine populates it from the split command).
   */
  function buildInclusiveGatewayWithTasksDefinition(): ReturnType<typeof buildSimpleSequenceDefinition> {
    const elements: BpmnFlowElement[] = [
      {
        id: 'start_1', type: 'startEvent', eventDefinition: { type: 'none' },
        incomingFlows: [], outgoingFlows: ['flow_1'],
      } as StartEventElement,
      {
        id: 'gw_split', type: 'inclusiveGateway', defaultFlow: 'flow_c',
        incomingFlows: ['flow_1'], outgoingFlows: ['flow_a', 'flow_b', 'flow_c'],
      } as any,
      {
        id: 'task_a', type: 'serviceTask', taskType: 'branch-a',
        incomingFlows: ['flow_a'], outgoingFlows: ['flow_join_a'],
      } as ServiceTaskElement,
      {
        id: 'task_b', type: 'serviceTask', taskType: 'branch-b',
        incomingFlows: ['flow_b'], outgoingFlows: ['flow_join_b'],
      } as ServiceTaskElement,
      {
        id: 'task_c', type: 'serviceTask', taskType: 'branch-c',
        incomingFlows: ['flow_c'], outgoingFlows: ['flow_join_c'],
      } as ServiceTaskElement,
      {
        id: 'gw_join', type: 'inclusiveGateway',
        incomingFlows: ['flow_join_a', 'flow_join_b', 'flow_join_c'], outgoingFlows: ['flow_end'],
      } as any,
      {
        id: 'end_1', type: 'endEvent', eventDefinition: { type: 'none' },
        incomingFlows: ['flow_end'], outgoingFlows: [],
      } as EndEventElement,
    ]

    const sequenceFlows: SequenceFlow[] = [
      { id: 'flow_1',      sourceRef: 'start_1',  targetRef: 'gw_split' },
      { id: 'flow_a',      sourceRef: 'gw_split', targetRef: 'task_a', conditionExpression: 'amount > 100' },
      { id: 'flow_b',      sourceRef: 'gw_split', targetRef: 'task_b', conditionExpression: 'amount > 50' },
      { id: 'flow_c',      sourceRef: 'gw_split', targetRef: 'task_c', isDefault: true },
      { id: 'flow_join_a', sourceRef: 'task_a',   targetRef: 'gw_join' },
      { id: 'flow_join_b', sourceRef: 'task_b',   targetRef: 'gw_join' },
      { id: 'flow_join_c', sourceRef: 'task_c',   targetRef: 'gw_join' },
      { id: 'flow_end',    sourceRef: 'gw_join',  targetRef: 'end_1' },
    ]

    return buildDefinition({ elements, sequenceFlows, startEventId: 'start_1' })
  }

  it('activates two branches when amount > 100 (flow_a and flow_b both true)', () => {
    const def = buildInclusiveGatewayDefinition()
    // When both conditions fire and the join sees 2 of 2 activated flows it should fire immediately
    const { newState } = execute(
      def,
      { type: 'StartProcess', variables: { amount: { type: 'number', value: 150 } } },
      null,
      options,
    )
    // flow_a and flow_b both activate; join fires immediately since both arrive in same tick
    expect(newState.instance.status).toBe('completed')
  })

  it('activates only one branch when amount <= 100 but > 50 (only flow_b true)', () => {
    const def = buildInclusiveGatewayDefinition()
    const { newState } = execute(
      def,
      { type: 'StartProcess', variables: { amount: { type: 'number', value: 75 } } },
      null,
      options,
    )
    // Only flow_b fires → join gets 1 of 1 expected → completes immediately
    expect(newState.instance.status).toBe('completed')
  })

  it('takes the default branch when no conditions are met and completes', () => {
    const def = buildInclusiveGatewayDefinition()
    const { newState } = execute(
      def,
      { type: 'StartProcess', variables: { amount: { type: 'number', value: 10 } } },
      null,
      options,
    )
    expect(newState.instance.status).toBe('completed')
  })

  it('pre-registers join state at split time when activated flows are join inputs (findInclusiveJoinIncoming runs)', () => {
    // The direct split→join topology: findInclusiveJoinIncoming can see that flow_a
    // and flow_b (the activated outgoing flows from the split) are also incoming flows
    // of gw_join. So it pre-registers join state before the join receives any token.
    // With amount=150 both flow_a (amount>100) and flow_b (amount>50) fire and both
    // reach the join in the same runLoop tick — the join fires and the process completes.
    const def = buildInclusiveGatewayDefinition()
    const { newState } = execute(
      def,
      { type: 'StartProcess', variables: { amount: { type: 'number', value: 150 } } },
      null,
      options,
    )
    // When both branches fire and the join receives both in the same tick, the process
    // completes (join state is consumed). No pending join state remains.
    expect(newState.instance.status).toBe('completed')
  })

  it('join state is consumed when the join fires — no dangling state remains', () => {
    // With amount=75, only flow_b is activated (flow_a false, default flow_c not taken).
    // The join sees 1 of 1 expected → fires immediately → process completes.
    const def = buildInclusiveGatewayDefinition()
    const { newState } = execute(
      def,
      { type: 'StartProcess', variables: { amount: { type: 'number', value: 75 } } },
      null,
      options,
    )
    expect(newState.instance.status).toBe('completed')
    // Join state should be cleared after join fires
    expect(newState.gatewayJoinStates).toHaveLength(0)
  })
})

// ─── Manual Task ──────────────────────────────────────────────────────────────

describe('ExecutionEngine — ManualTask', () => {
  beforeEach(() => { idCounter = 0 })

  function buildManualTaskDefinition(): ReturnType<typeof buildSimpleSequenceDefinition> {
    const start: StartEventElement = {
      id: 'start_1',
      type: 'startEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: ['flow_1'],
    }
    const manualTask: ManualTaskElement = {
      id: 'manual_1',
      type: 'manualTask',
      incomingFlows: ['flow_1'],
      outgoingFlows: ['flow_2'],
    }
    const end: EndEventElement = {
      id: 'end_1',
      type: 'endEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: ['flow_2'],
      outgoingFlows: [],
    }
    return buildDefinition({
      elements: [start, manualTask, end],
      sequenceFlows: [
        { id: 'flow_1', sourceRef: 'start_1', targetRef: 'manual_1' },
        { id: 'flow_2', sourceRef: 'manual_1', targetRef: 'end_1' },
      ],
      startEventId: 'start_1',
    })
  }

  it('auto-completes a manual task and runs the process to completion', () => {
    const def = buildManualTaskDefinition()
    const { newState } = execute(def, { type: 'StartProcess' }, null, options)
    expect(newState.instance.status).toBe('completed')
  })

  it('no tokens are left waiting after a manual task auto-completes', () => {
    const def = buildManualTaskDefinition()
    const { newState } = execute(def, { type: 'StartProcess' }, null, options)
    expect(newState.tokens.filter(t => t.status === 'waiting')).toHaveLength(0)
  })
})

// ─── Script Task ──────────────────────────────────────────────────────────────

describe('ExecutionEngine — ScriptTask', () => {
  beforeEach(() => { idCounter = 0 })

  function buildScriptTaskDefinition(): ReturnType<typeof buildSimpleSequenceDefinition> {
    const start: StartEventElement = {
      id: 'start_1',
      type: 'startEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: ['flow_1'],
    }
    const scriptTask: ScriptTaskElement = {
      id: 'script_1',
      type: 'scriptTask',
      scriptLanguage: 'javascript',
      script: 'return 1 + 1',
      incomingFlows: ['flow_1'],
      outgoingFlows: ['flow_2'],
    }
    const end: EndEventElement = {
      id: 'end_1',
      type: 'endEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: ['flow_2'],
      outgoingFlows: [],
    }
    return buildDefinition({
      elements: [start, scriptTask, end],
      sequenceFlows: [
        { id: 'flow_1', sourceRef: 'start_1', targetRef: 'script_1' },
        { id: 'flow_2', sourceRef: 'script_1', targetRef: 'end_1' },
      ],
      startEventId: 'start_1',
    })
  }

  it('suspends the token at a script task waiting for external completion', () => {
    const def = buildScriptTaskDefinition()
    const { newState } = execute(def, { type: 'StartProcess' }, null, options)
    const waiting = newState.tokens.filter(t => t.status === 'waiting')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]?.elementId).toBe('script_1')
  })

  it('script task token waitingFor type is external', () => {
    const def = buildScriptTaskDefinition()
    const { newState } = execute(def, { type: 'StartProcess' }, null, options)
    const scriptToken = newState.tokens.find(t => t.elementId === 'script_1')!
    expect(scriptToken.waitingFor?.type).toBe('external')
  })

  it('completes on CompleteServiceTask and runs to completion', () => {
    const def = buildScriptTaskDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)
    const scriptToken = s0.tokens.find(t => t.status === 'waiting')!
    const { newState } = execute(def, { type: 'CompleteServiceTask', tokenId: scriptToken.id }, s0, options)
    expect(newState.instance.status).toBe('completed')
  })
})
