import { describe, it, expect, beforeEach } from 'vitest'
import { execute } from './ExecutionEngine.js'
import type { EngineState, EngineCommand } from './ExecutionEngine.js'
import { RuntimeError } from '../model/errors.js'
import {
  buildSimpleSequenceDefinition,
  buildServiceTaskDefinition,
  buildUserTaskDefinition,
  buildXorGatewayDefinition,
  buildParallelGatewayDefinition,
} from '../../tests/fixtures/builders/ProcessDefinitionBuilder.js'

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
