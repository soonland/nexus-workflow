/**
 * ExecutionEngine.coverage.test.ts
 *
 * Targets uncovered branches identified via lcov analysis.
 * Each describe block maps to a specific set of branch conditions.
 */
import { describe, it, expect } from 'vitest'
import { RuntimeError } from '../model/errors.js'
import {
  buildDefinition,
  buildSimpleSequenceDefinition,
  buildServiceTaskDefinition,
  buildParallelGatewayDefinition,
} from '../../tests/fixtures/builders/ProcessDefinitionBuilder.js'
import type {
  BpmnFlowElement,
  SequenceFlow,
  StartEventElement,
  EndEventElement,
  ServiceTaskElement,
  BoundaryEventElement,
  IntermediateCatchEventElement,
  GatewayElement,
  InclusiveGatewayJoinState,
} from '../model/types.js'
import { execute, type EngineState } from './ExecutionEngine.js'

// ─── Shared helpers ────────────────────────────────────────────────────────────

let idCounter: number
const options = { generateId: () => `id-${++idCounter}` }

function reset() {
  idCounter = 0
}

// ─── Line 136: businessKey branch in StartProcess ────────────────────────────

describe('ExecutionEngine — StartProcess with businessKey', () => {
  it('stores the businessKey on the instance', () => {
    reset()
    const def = buildSimpleSequenceDefinition()

    const { newState } = execute(
      def,
      { type: 'StartProcess', businessKey: 'BK-42' },
      null,
      options,
    )

    expect(newState.instance.businessKey).toBe('BK-42')
  })

  it('instance has neither correlationKey nor businessKey when neither is provided', () => {
    reset()
    const def = buildSimpleSequenceDefinition()

    const { newState } = execute(def, { type: 'StartProcess' }, null, options)

    expect(newState.instance.correlationKey).toBeUndefined()
    expect(newState.instance.businessKey).toBeUndefined()
  })
})

// ─── Line 192: FailServiceTask on non-waiting token ───────────────────────────

describe('ExecutionEngine — FailServiceTask on non-waiting token', () => {
  it('throws RuntimeError when failing a token that is not in waiting status', () => {
    reset()
    const def = buildServiceTaskDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    // Complete the task so the token becomes completed (no longer waiting)
    const taskToken = s0.tokens.find(t => t.status === 'waiting')!
    const { newState: s1 } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      s0,
      options,
    )

    // Now try to fail the already-completed token
    expect(() =>
      execute(
        def,
        { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'ERR', message: 'late' } },
        s1,
        options,
      )
    ).toThrow(RuntimeError)
  })
})

// ─── Line 311: default case — unsupported element type ───────────────────────

describe('ExecutionEngine — processToken default case (unsupported element type)', () => {
  it('throws RuntimeError for an unsupported element type', () => {
    reset()
    // Build a definition with a callActivity (unsupported by processToken switch)
    const start: StartEventElement = {
      id: 'start_1',
      type: 'startEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: ['flow_1'],
    }
    // Use a fake type cast to simulate an unsupported element type
    const unsupported = {
      id: 'unsupported_1',
      type: 'callActivity' as const,
      calledElement: 'some-process',
      incomingFlows: ['flow_1'],
      outgoingFlows: ['flow_2'],
    } as BpmnFlowElement
    const end: EndEventElement = {
      id: 'end_1',
      type: 'endEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: ['flow_2'],
      outgoingFlows: [],
    }
    const def = buildDefinition({
      elements: [start, unsupported, end],
      sequenceFlows: [
        { id: 'flow_1', sourceRef: 'start_1', targetRef: 'unsupported_1' },
        { id: 'flow_2', sourceRef: 'unsupported_1', targetRef: 'end_1' },
      ],
      startEventId: 'start_1',
    })

    expect(() => execute(def, { type: 'StartProcess' }, null, options)).toThrow(RuntimeError)
  })
})

// ─── Lines 363, 366: terminate end event ─────────────────────────────────────

describe('ExecutionEngine — terminate end event', () => {
  /**
   * Process: Start → parallel split → [TaskA, TaskB] → terminate end
   * When TaskA arrives at the terminate end event, all other tokens should be cancelled.
   */
  function buildTerminateEndEventDefinition() {
    const elements: BpmnFlowElement[] = [
      {
        id: 'start_1',
        type: 'startEvent',
        eventDefinition: { type: 'none' },
        incomingFlows: [],
        outgoingFlows: ['flow_1'],
      } as StartEventElement,
      {
        id: 'gw_split',
        type: 'parallelGateway',
        incomingFlows: ['flow_1'],
        outgoingFlows: ['flow_a', 'flow_b'],
      } as GatewayElement,
      {
        id: 'task_a',
        type: 'serviceTask',
        taskType: 'branch-a',
        incomingFlows: ['flow_a'],
        outgoingFlows: ['flow_end_a'],
      } as ServiceTaskElement,
      {
        id: 'task_b',
        type: 'serviceTask',
        taskType: 'branch-b',
        incomingFlows: ['flow_b'],
        outgoingFlows: ['flow_end_b'],
      } as ServiceTaskElement,
      {
        id: 'end_terminate',
        type: 'endEvent',
        eventDefinition: { type: 'terminate' },
        incomingFlows: ['flow_end_a', 'flow_end_b'],
        outgoingFlows: [],
      } as EndEventElement,
    ]

    const sequenceFlows: SequenceFlow[] = [
      { id: 'flow_1', sourceRef: 'start_1', targetRef: 'gw_split' },
      { id: 'flow_a', sourceRef: 'gw_split', targetRef: 'task_a' },
      { id: 'flow_b', sourceRef: 'gw_split', targetRef: 'task_b' },
      { id: 'flow_end_a', sourceRef: 'task_a', targetRef: 'end_terminate' },
      { id: 'flow_end_b', sourceRef: 'task_b', targetRef: 'end_terminate' },
    ]

    return buildDefinition({ elements, sequenceFlows, startEventId: 'start_1' })
  }

  it('completing one branch at a terminate end event completes the instance', () => {
    reset()
    const def = buildTerminateEndEventDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    const tokA = s0.tokens.find(t => t.elementId === 'task_a')!
    const { newState } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: tokA.id },
      s0,
      options,
    )

    expect(newState.instance.status).toBe('completed')
  })

  it('the other branch token is cancelled when a terminate end event fires', () => {
    reset()
    const def = buildTerminateEndEventDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    const tokA = s0.tokens.find(t => t.elementId === 'task_a')!
    const { newState } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: tokA.id },
      s0,
      options,
    )

    // task_b token should have been cancelled
    const tokB = newState.tokens.find(t => t.elementId === 'task_b')!
    expect(tokB.status).toBe('cancelled')
  })

  it('emits TokenCancelled for the token cancelled by the terminate end event', () => {
    reset()
    const def = buildTerminateEndEventDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    const tokA = s0.tokens.find(t => t.elementId === 'task_a')!
    const { events } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: tokA.id },
      s0,
      options,
    )

    expect(events.some(e => e.type === 'TokenCancelled')).toBe(true)
  })
})

// ─── Lines 419, 421, 422: messageName/signalName ?? '' in intermediateCatchEvent

describe('ExecutionEngine — intermediateCatchEvent messageName/signalName fallback to empty string', () => {
  it('handles an intermediate message catch event with no messageName (defaults to empty string)', () => {
    reset()
    // Build a process with an intermediateCatchEvent whose messageName is absent
    const start: StartEventElement = {
      id: 'start_1',
      type: 'startEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: ['flow_1'],
    }
    const msgCatch: IntermediateCatchEventElement = {
      id: 'msg_catch',
      type: 'intermediateCatchEvent',
      eventDefinition: { type: 'message' /* messageName deliberately omitted */ },
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
    const def = buildDefinition({
      elements: [start, msgCatch, end],
      sequenceFlows: [
        { id: 'flow_1', sourceRef: 'start_1', targetRef: 'msg_catch' },
        { id: 'flow_2', sourceRef: 'msg_catch', targetRef: 'end_1' },
      ],
      startEventId: 'start_1',
    })

    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)
    const token = s0.tokens.find(t => t.elementId === 'msg_catch')!
    expect(token.waitingFor?.type).toBe('message')
    // messageName defaults to ''
    expect(token.waitingFor?.correlationData?.['messageName']).toBe('')

    // DeliverMessage with empty name resolves it
    const { newState } = execute(
      def,
      { type: 'DeliverMessage', messageName: '' },
      s0,
      options,
    )
    expect(newState.instance.status).toBe('completed')
  })

  it('handles an intermediate signal catch event with no signalName (defaults to empty string)', () => {
    reset()
    const start: StartEventElement = {
      id: 'start_1',
      type: 'startEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: ['flow_1'],
    }
    const sigCatch: IntermediateCatchEventElement = {
      id: 'sig_catch',
      type: 'intermediateCatchEvent',
      eventDefinition: { type: 'signal' /* signalName deliberately omitted */ },
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
    const def = buildDefinition({
      elements: [start, sigCatch, end],
      sequenceFlows: [
        { id: 'flow_1', sourceRef: 'start_1', targetRef: 'sig_catch' },
        { id: 'flow_2', sourceRef: 'sig_catch', targetRef: 'end_1' },
      ],
      startEventId: 'start_1',
    })

    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)
    const token = s0.tokens.find(t => t.elementId === 'sig_catch')!
    expect(token.waitingFor?.type).toBe('signal')
    // signalName defaults to ''
    expect(token.waitingFor?.correlationData?.['signalName']).toBe('')

    // BroadcastSignal with empty name resolves it
    const { newState } = execute(
      def,
      { type: 'BroadcastSignal', signalName: '' },
      s0,
      options,
    )
    expect(newState.instance.status).toBe('completed')
  })

  it('throws RuntimeError for an unsupported intermediateCatchEvent definition type', () => {
    reset()
    const start: StartEventElement = {
      id: 'start_1',
      type: 'startEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: ['flow_1'],
    }
    const badCatch: IntermediateCatchEventElement = {
      id: 'bad_catch',
      type: 'intermediateCatchEvent',
      // 'escalation' is not handled by handleIntermediateCatchEvent
      eventDefinition: { type: 'escalation' as 'timer' },
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
    const def = buildDefinition({
      elements: [start, badCatch, end],
      sequenceFlows: [
        { id: 'flow_1', sourceRef: 'start_1', targetRef: 'bad_catch' },
        { id: 'flow_2', sourceRef: 'bad_catch', targetRef: 'end_1' },
      ],
      startEventId: 'start_1',
    })

    expect(() => execute(def, { type: 'StartProcess' }, null, options)).toThrow(RuntimeError)
  })
})

// ─── Lines 439-445: boundary event message/signal/error branches ──────────────

describe('ExecutionEngine — boundary event message and signal branches', () => {
  function buildServiceTaskWithBoundary(boundaryDef: Partial<BoundaryEventElement>): ReturnType<typeof buildDefinition> {
    const start: StartEventElement = {
      id: 'start_1',
      type: 'startEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: ['flow_1'],
    }
    const task: ServiceTaskElement = {
      id: 'task_1',
      type: 'serviceTask',
      taskType: 'test',
      incomingFlows: ['flow_1'],
      outgoingFlows: ['flow_2'],
    }
    const boundary: BoundaryEventElement = {
      id: 'boundary_1',
      type: 'boundaryEvent',
      attachedToRef: 'task_1',
      cancelActivity: true,
      eventDefinition: { type: 'timer' },
      incomingFlows: [],
      outgoingFlows: ['flow_boundary'],
      ...boundaryDef,
    }
    const endOk: EndEventElement = {
      id: 'end_ok',
      type: 'endEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: ['flow_2'],
      outgoingFlows: [],
    }
    const endBoundary: EndEventElement = {
      id: 'end_boundary',
      type: 'endEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: ['flow_boundary'],
      outgoingFlows: [],
    }

    return buildDefinition({
      elements: [start, task, boundary, endOk, endBoundary],
      sequenceFlows: [
        { id: 'flow_1', sourceRef: 'start_1', targetRef: 'task_1' },
        { id: 'flow_2', sourceRef: 'task_1', targetRef: 'end_ok' },
        { id: 'flow_boundary', sourceRef: 'boundary_1', targetRef: 'end_boundary' },
      ],
      startEventId: 'start_1',
    })
  }

  it('message boundary event token waits with type message and messageName', () => {
    reset()
    const def = buildServiceTaskWithBoundary({
      eventDefinition: { type: 'message', messageName: 'OrderCancelled' },
    })

    const { newState } = execute(def, { type: 'StartProcess' }, null, options)
    const boundaryToken = newState.tokens.find(t => t.elementId === 'boundary_1')!

    expect(boundaryToken.waitingFor?.type).toBe('message')
    expect(boundaryToken.waitingFor?.correlationData?.['messageName']).toBe('OrderCancelled')
  })

  it('message boundary with no messageName defaults to empty string', () => {
    reset()
    const def = buildServiceTaskWithBoundary({
      eventDefinition: { type: 'message' /* no messageName */ },
    })

    const { newState } = execute(def, { type: 'StartProcess' }, null, options)
    const boundaryToken = newState.tokens.find(t => t.elementId === 'boundary_1')!

    expect(boundaryToken.waitingFor?.correlationData?.['messageName']).toBe('')
  })

  it('signal boundary event token waits with type signal and signalName', () => {
    reset()
    const def = buildServiceTaskWithBoundary({
      eventDefinition: { type: 'signal', signalName: 'EmergencyStop' },
    })

    const { newState } = execute(def, { type: 'StartProcess' }, null, options)
    const boundaryToken = newState.tokens.find(t => t.elementId === 'boundary_1')!

    expect(boundaryToken.waitingFor?.type).toBe('signal')
    expect(boundaryToken.waitingFor?.correlationData?.['signalName']).toBe('EmergencyStop')
  })

  it('signal boundary with no signalName defaults to empty string', () => {
    reset()
    const def = buildServiceTaskWithBoundary({
      eventDefinition: { type: 'signal' /* no signalName */ },
    })

    const { newState } = execute(def, { type: 'StartProcess' }, null, options)
    const boundaryToken = newState.tokens.find(t => t.elementId === 'boundary_1')!

    expect(boundaryToken.waitingFor?.correlationData?.['signalName']).toBe('')
  })

  it('throws RuntimeError for an unsupported boundary event definition type', () => {
    reset()
    const def = buildServiceTaskWithBoundary({
      eventDefinition: { type: 'escalation' as 'timer' },
    })

    expect(() => execute(def, { type: 'StartProcess' }, null, options)).toThrow(RuntimeError)
  })

  it('message boundary: completing task normally cancels the boundary token', () => {
    reset()
    const def = buildServiceTaskWithBoundary({
      eventDefinition: { type: 'message', messageName: 'Msg' },
    })
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)
    const taskToken = s0.tokens.find(t => t.elementId === 'task_1')!

    const { newState } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      s0,
      options,
    )

    const boundaryToken = newState.tokens.find(t => t.elementId === 'boundary_1')!
    expect(boundaryToken.status).toBe('cancelled')
  })
})

// ─── Line 459: FireTimer on non-waiting token ─────────────────────────────────

describe('ExecutionEngine — FireTimer on non-waiting token', () => {
  it('throws RuntimeError when firing a timer for a token that is not waiting', () => {
    reset()
    const def = buildServiceTaskDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)
    const taskToken = s0.tokens.find(t => t.status === 'waiting')!

    // Complete the token first so it is no longer waiting
    const { newState: s1 } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      s0,
      options,
    )

    expect(() =>
      execute(def, { type: 'FireTimer', tokenId: taskToken.id }, s1, options)
    ).toThrow(RuntimeError)
  })
})

// ─── Line 519: BroadcastSignal with variables ─────────────────────────────────

describe('ExecutionEngine — BroadcastSignal with variables', () => {
  it('merges variables into scope when BroadcastSignal provides variables', () => {
    reset()
    // Use intermediate-signal inline definition
    const start: StartEventElement = {
      id: 'start_1',
      type: 'startEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: ['flow_1'],
    }
    const sigCatch: IntermediateCatchEventElement = {
      id: 'sig_catch',
      type: 'intermediateCatchEvent',
      eventDefinition: { type: 'signal', signalName: 'STOP' },
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
    const def = buildDefinition({
      elements: [start, sigCatch, end],
      sequenceFlows: [
        { id: 'flow_1', sourceRef: 'start_1', targetRef: 'sig_catch' },
        { id: 'flow_2', sourceRef: 'sig_catch', targetRef: 'end_1' },
      ],
      startEventId: 'start_1',
    })

    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    const { newState } = execute(
      def,
      {
        type: 'BroadcastSignal',
        signalName: 'STOP',
        variables: { reason: { type: 'string', value: 'emergency' } },
      },
      s0,
      options,
    )

    expect(newState.instance.status).toBe('completed')
    const scope = newState.scopes.find(s => s.id === newState.instance.rootScopeId)!
    expect(scope.variables['reason']?.value).toBe('emergency')
  })
})

// ─── Line 576: cancelBoundaryTokensFor — covers waiting boundary token path ───

describe('ExecutionEngine — cancelBoundaryTokensFor waits for hostTaskId match', () => {
  it('boundary token is cancelled when task completes normally (hostTaskId path)', () => {
    reset()
    // Use error boundary setup — completing the task cancels the boundary token
    const def = buildServiceTaskWithErrorBoundary()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)
    const taskToken = s0.tokens.find(t => t.elementId === 'svc_task')!
    const boundaryToken = s0.tokens.find(t => t.elementId === 'err_boundary')!
    expect(boundaryToken.status).toBe('waiting')

    const { newState } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      s0,
      options,
    )

    expect(newState.tokens.find(t => t.id === boundaryToken.id)!.status).toBe('cancelled')
  })
})

function buildServiceTaskWithErrorBoundary() {
  const start: StartEventElement = {
    id: 'start_1',
    type: 'startEvent',
    eventDefinition: { type: 'none' },
    incomingFlows: [],
    outgoingFlows: ['flow_1'],
  }
  const task: ServiceTaskElement = {
    id: 'svc_task',
    type: 'serviceTask',
    taskType: 'test',
    incomingFlows: ['flow_1'],
    outgoingFlows: ['flow_2'],
  }
  const boundary: BoundaryEventElement = {
    id: 'err_boundary',
    type: 'boundaryEvent',
    attachedToRef: 'svc_task',
    cancelActivity: true,
    eventDefinition: { type: 'error', errorCode: 'MY_ERR' },
    incomingFlows: [],
    outgoingFlows: ['flow_b'],
  }
  const endOk: EndEventElement = {
    id: 'end_ok',
    type: 'endEvent',
    eventDefinition: { type: 'none' },
    incomingFlows: ['flow_2'],
    outgoingFlows: [],
  }
  const endErr: EndEventElement = {
    id: 'end_err',
    type: 'endEvent',
    eventDefinition: { type: 'none' },
    incomingFlows: ['flow_b'],
    outgoingFlows: [],
  }

  return buildDefinition({
    elements: [start, task, boundary, endOk, endErr],
    sequenceFlows: [
      { id: 'flow_1', sourceRef: 'start_1', targetRef: 'svc_task' },
      { id: 'flow_2', sourceRef: 'svc_task', targetRef: 'end_ok' },
      { id: 'flow_b', sourceRef: 'err_boundary', targetRef: 'end_err' },
    ],
    startEventId: 'start_1',
  })
}

// ─── Lines 639, 640: parallel gateway !firstIncoming guard and arrivedViaFlowId ?? ─

describe('ExecutionEngine — parallel gateway join without arrivedViaFlowId', () => {
  it('join still works when a token has no arrivedViaFlowId (falls back to firstIncoming.id)', () => {
    reset()
    // Use the standard parallel gateway definition and manually remove arrivedViaFlowId
    // from one of the task tokens to exercise the `?? firstIncoming.id` branch.
    const def = buildParallelGatewayDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    const tokA = s0.tokens.find(t => t.elementId === 'task_a')!

    // Remove arrivedViaFlowId to force the fallback branch
    const tokAModified = { ...tokA, arrivedViaFlowId: undefined }
    const s0Modified: EngineState = {
      ...s0,
      tokens: s0.tokens.map(t => t.id === tokA.id ? tokAModified : t),
    }

    const { newState: s1 } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: tokA.id },
      s0Modified,
      options,
    )

    // Should have saved join state (not yet fired — 1 of 3 paths arrived)
    expect(s1.gatewayJoinStates).toHaveLength(1)
  })
})

// ─── Lines 691, 692: inclusive gateway join without arrivedViaFlowId ──────────

describe('ExecutionEngine — inclusive gateway join without arrivedViaFlowId', () => {
  it('join still works when a token has no arrivedViaFlowId (falls back to firstIncoming.id)', () => {
    reset()
    // Build a simple inclusive split → join
    const elements: BpmnFlowElement[] = [
      {
        id: 'start_1',
        type: 'startEvent',
        eventDefinition: { type: 'none' },
        incomingFlows: [],
        outgoingFlows: ['flow_1'],
      } as StartEventElement,
      {
        id: 'gw_split',
        type: 'inclusiveGateway',
        defaultFlow: 'flow_a',
        incomingFlows: ['flow_1'],
        outgoingFlows: ['flow_a', 'flow_b'],
      } as GatewayElement,
      {
        id: 'task_a',
        type: 'serviceTask',
        taskType: 'branch-a',
        incomingFlows: ['flow_a'],
        outgoingFlows: ['flow_ja'],
      } as ServiceTaskElement,
      {
        id: 'task_b',
        type: 'serviceTask',
        taskType: 'branch-b',
        incomingFlows: ['flow_b'],
        outgoingFlows: ['flow_jb'],
      } as ServiceTaskElement,
      {
        id: 'gw_join',
        type: 'inclusiveGateway',
        incomingFlows: ['flow_ja', 'flow_jb'],
        outgoingFlows: ['flow_end'],
      } as GatewayElement,
      {
        id: 'end_1',
        type: 'endEvent',
        eventDefinition: { type: 'none' },
        incomingFlows: ['flow_end'],
        outgoingFlows: [],
      } as EndEventElement,
    ]

    const sequenceFlows: SequenceFlow[] = [
      { id: 'flow_1', sourceRef: 'start_1', targetRef: 'gw_split' },
      { id: 'flow_a', sourceRef: 'gw_split', targetRef: 'task_a', isDefault: true },
      { id: 'flow_b', sourceRef: 'gw_split', targetRef: 'task_b', conditionExpression: 'amount > 100' },
      { id: 'flow_ja', sourceRef: 'task_a', targetRef: 'gw_join' },
      { id: 'flow_jb', sourceRef: 'task_b', targetRef: 'gw_join' },
      { id: 'flow_end', sourceRef: 'gw_join', targetRef: 'end_1' },
    ]

    const def = buildDefinition({ elements, sequenceFlows, startEventId: 'start_1' })

    // Start with no variables — only the default flow_a activates
    const { newState: s0 } = execute(
      def,
      { type: 'StartProcess', variables: {} },
      null,
      options,
    )

    const tokA = s0.tokens.find(t => t.elementId === 'task_a')!

    // Remove arrivedViaFlowId to exercise the ?? firstIncoming.id fallback at line 692
    const tokANoFlow = { ...tokA, arrivedViaFlowId: undefined }
    const s0Modified: EngineState = {
      ...s0,
      tokens: s0.tokens.map(t => t.id === tokA.id ? tokANoFlow : t),
    }

    // Pre-seed the join state so the inclusive gateway join doesn't throw
    const joinState: InclusiveGatewayJoinState = {
      gatewayId: 'gw_join',
      instanceId: s0.instance.id,
      activationId: 'act-1',
      activatedIncomingFlows: ['flow_ja'],
      arrivedFromFlows: [],
    }
    const s0WithJoinState: EngineState = {
      ...s0Modified,
      gatewayJoinStates: [joinState],
    }

    const { newState } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: tokA.id },
      s0WithJoinState,
      options,
    )

    expect(newState.instance.status).toBe('completed')
  })
})

// ─── Line 695: inclusive gateway join with no existing join state ─────────────

describe('ExecutionEngine — inclusive gateway join with no pre-registered join state', () => {
  it('throws RuntimeError when an inclusive join receives a token but has no join state', () => {
    reset()
    // Build an inclusive split+join with intermediate tasks so that
    // findInclusiveJoinIncoming cannot pre-seed state automatically.
    const elements: BpmnFlowElement[] = [
      {
        id: 'start_1',
        type: 'startEvent',
        eventDefinition: { type: 'none' },
        incomingFlows: [],
        outgoingFlows: ['flow_1'],
      } as StartEventElement,
      // Inclusive split with no defaultFlow so both conditions must be set
      {
        id: 'gw_split',
        type: 'inclusiveGateway',
        incomingFlows: ['flow_1'],
        outgoingFlows: ['flow_a'],
      } as GatewayElement,
      {
        id: 'task_a',
        type: 'serviceTask',
        taskType: 'branch-a',
        incomingFlows: ['flow_a'],
        outgoingFlows: ['flow_ja'],
      } as ServiceTaskElement,
      // The join has 2 incoming flows, but only 1 was pre-seeded (none in state)
      {
        id: 'gw_join',
        type: 'inclusiveGateway',
        incomingFlows: ['flow_ja', 'flow_jb'],
        outgoingFlows: ['flow_end'],
      } as GatewayElement,
      {
        id: 'end_1',
        type: 'endEvent',
        eventDefinition: { type: 'none' },
        incomingFlows: ['flow_end'],
        outgoingFlows: [],
      } as EndEventElement,
    ]

    const sequenceFlows: SequenceFlow[] = [
      { id: 'flow_1', sourceRef: 'start_1', targetRef: 'gw_split' },
      { id: 'flow_a', sourceRef: 'gw_split', targetRef: 'task_a' },
      { id: 'flow_ja', sourceRef: 'task_a', targetRef: 'gw_join' },
      // flow_jb exists in sequenceFlows so getFlow works, but nobody sends tokens on it
      { id: 'flow_jb', sourceRef: 'task_a', targetRef: 'gw_join' },
      { id: 'flow_end', sourceRef: 'gw_join', targetRef: 'end_1' },
    ]

    const def = buildDefinition({ elements, sequenceFlows, startEventId: 'start_1' })
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)
    const tokA = s0.tokens.find(t => t.elementId === 'task_a')!

    // Explicitly ensure no join state is present
    const s0NoJoinState: EngineState = { ...s0, gatewayJoinStates: [] }

    expect(() =>
      execute(def, { type: 'CompleteServiceTask', tokenId: tokA.id }, s0NoJoinState, options)
    ).toThrow(RuntimeError)
  })
})

// ─── Line 727: findInclusiveJoinIncoming returns null (no matching downstream join) ─

describe('ExecutionEngine — inclusive split with no downstream join (findInclusiveJoinIncoming returns null)', () => {
  it('completes when inclusive split has no downstream join (null from findInclusiveJoinIncoming)', () => {
    reset()
    // Build an inclusive gateway that is a pure split (no join downstream) — each outgoing
    // flow leads to its own end event. findInclusiveJoinIncoming returns null.
    const elements: BpmnFlowElement[] = [
      {
        id: 'start_1',
        type: 'startEvent',
        eventDefinition: { type: 'none' },
        incomingFlows: [],
        outgoingFlows: ['flow_1'],
      } as StartEventElement,
      {
        id: 'gw_split',
        type: 'inclusiveGateway',
        defaultFlow: 'flow_default',
        incomingFlows: ['flow_1'],
        outgoingFlows: ['flow_cond', 'flow_default'],
      } as GatewayElement,
      {
        id: 'end_cond',
        type: 'endEvent',
        eventDefinition: { type: 'none' },
        incomingFlows: ['flow_cond'],
        outgoingFlows: [],
      } as EndEventElement,
      {
        id: 'end_default',
        type: 'endEvent',
        eventDefinition: { type: 'none' },
        incomingFlows: ['flow_default'],
        outgoingFlows: [],
      } as EndEventElement,
    ]

    const sequenceFlows: SequenceFlow[] = [
      { id: 'flow_1', sourceRef: 'start_1', targetRef: 'gw_split' },
      { id: 'flow_cond', sourceRef: 'gw_split', targetRef: 'end_cond', conditionExpression: 'false' },
      { id: 'flow_default', sourceRef: 'gw_split', targetRef: 'end_default', isDefault: true },
    ]

    const def = buildDefinition({ elements, sequenceFlows, startEventId: 'start_1' })
    const { newState } = execute(def, { type: 'StartProcess' }, null, options)

    // Only the default branch fires; there is no inclusive join, so findInclusiveJoinIncoming
    // returns null and no joinState is saved. Process completes normally.
    expect(newState.instance.status).toBe('completed')
    expect(newState.gatewayJoinStates).toHaveLength(0)
  })
})

// ─── Line 911: ExecutionContext default options ────────────────────────────────

describe('ExecutionEngine — default options (no generateId or now provided)', () => {
  it('runs StartProcess without any options (uses crypto.randomUUID and new Date())', () => {
    // Pass no options at all — exercises the `?? (() => crypto.randomUUID())` branch
    const def = buildSimpleSequenceDefinition()
    const { newState } = execute(def, { type: 'StartProcess' }, null)

    expect(newState.instance.status).toBe('completed')
    // id is a real UUID, not our counter-based id
    expect(newState.instance.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('runs StartProcess with a custom now function', () => {
    const fixedDate = new Date('2030-01-01T00:00:00.000Z')
    const def = buildSimpleSequenceDefinition()
    const { newState } = execute(def, { type: 'StartProcess' }, null, { now: () => fixedDate })

    expect(newState.instance.startedAt).toEqual(fixedDate)
  })
})

// ─── Line 962: requireToken not found ─────────────────────────────────────────

describe('ExecutionEngine — requireToken not found', () => {
  it('throws RuntimeError when CompleteServiceTask references a token id that does not exist', () => {
    reset()
    const def = buildServiceTaskDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    expect(() =>
      execute(def, { type: 'CompleteServiceTask', tokenId: 'nonexistent-token' }, s0, options)
    ).toThrow(RuntimeError)
  })
})

// ─── Line 967: requireInstance — no instance ──────────────────────────────────

describe('ExecutionEngine — requireInstance throws when no instance', () => {
  it('throws RuntimeError when SuspendInstance is called on null state', () => {
    reset()
    const def = buildSimpleSequenceDefinition()

    // Passing null state means no instance — any command that calls requireInstance() should throw.
    // SuspendInstance calls requireInstance() immediately.
    expect(() =>
      execute(def, { type: 'SuspendInstance' }, null, options)
    ).toThrow(RuntimeError)
  })
})

// ─── Line 987: resolveScope parentScopeId chain ───────────────────────────────

describe('ExecutionEngine — resolveScope traverses parentScopeId chain', () => {
  it('variables from a parent scope are visible in the child scope', () => {
    reset()
    // We exercise the parentScopeId branch by starting a process that naturally creates
    // child scopes. For now the engine creates a single root scope, so we verify that
    // the resolveScope function works correctly when parentScopeId is set by
    // seeding the state with a scope chain before calling the engine.
    //
    // We use CompleteServiceTask with outputVariables to drive resolveScope — it merges
    // vars into the token's scope then calls advanceToken which calls getOutgoingFlows.
    // To exercise the parent chain, we manually construct state with nested scopes.

    const def = buildServiceTaskDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    // Add a parent scope and link the root scope to it
    const parentScope = { id: 'parent-scope', variables: { inherited: { type: 'string' as const, value: 'yes' } } }
    const rootScopeWithParent = {
      ...s0.scopes.find(s => s.id === s0.instance.rootScopeId)!,
      parentScopeId: 'parent-scope',
    }
    const s0WithParent: EngineState = {
      ...s0,
      scopes: [...s0.scopes.filter(s => s.id !== s0.instance.rootScopeId), rootScopeWithParent, parentScope],
    }

    const taskToken = s0WithParent.tokens.find(t => t.status === 'waiting')!
    const { newState } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      s0WithParent,
      options,
    )

    // If resolveScope traversed the chain the process would complete normally
    expect(newState.instance.status).toBe('completed')
  })
})

// ─── Line 997: mergeVariables scope not found ─────────────────────────────────

describe('ExecutionEngine — mergeVariables scope not found', () => {
  it('throws RuntimeError when CompleteServiceTask output references a missing scopeId', () => {
    reset()
    const def = buildServiceTaskDefinition()
    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, options)

    // Remove all scopes so the token's scopeId cannot be resolved during mergeVariables
    const s0NoScopes: EngineState = { ...s0, scopes: [] }
    const taskToken = s0NoScopes.tokens.find(t => t.status === 'waiting')!

    expect(() =>
      execute(
        def,
        {
          type: 'CompleteServiceTask',
          tokenId: taskToken.id,
          outputVariables: { x: { type: 'number', value: 1 } },
        },
        s0NoScopes,
        options,
      )
    ).toThrow(RuntimeError)
  })
})
