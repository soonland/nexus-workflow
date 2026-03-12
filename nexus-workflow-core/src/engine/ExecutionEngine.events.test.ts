import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseBpmn } from '../parser/BpmnXmlParser.js'
import { execute } from './ExecutionEngine.js'
import type { EngineState } from './ExecutionEngine.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fixtureDir = join(import.meta.dirname, '../../tests/fixtures/bpmn')

function loadDef(name: string) {
  const xml = readFileSync(join(fixtureDir, name), 'utf-8')
  const { definition, errors } = parseBpmn(xml)
  if (errors.length > 0) throw new Error(`Fixture "${name}" has validation errors: ${JSON.stringify(errors)}`)
  return definition!
}

let idCounter = 0
const opts = { generateId: () => `id-${++idCounter}` }

function start(fixture: string): { state: EngineState; def: ReturnType<typeof loadDef> } {
  idCounter = 0
  const def = loadDef(fixture)
  const { newState } = execute(def, { type: 'StartProcess' }, null, opts)
  return { state: newState, def }
}

// ─── Intermediate timer catch event ───────────────────────────────────────────

describe('ExecutionEngine — intermediate timer catch event', () => {
  it('token waits at the timer catch event after StartProcess', () => {
    const { state } = start('intermediate-timer.bpmn')
    const waiting = state.tokens.filter(t => t.status === 'waiting')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]!.elementId).toBe('timer_catch')
    expect(waiting[0]!.elementType).toBe('intermediateCatchEvent')
  })

  it('waitingFor is set to timer on the catch event token', () => {
    const { state } = start('intermediate-timer.bpmn')
    const token = state.tokens.find(t => t.status === 'waiting')!
    expect(token.waitingFor?.type).toBe('timer')
  })

  it('FireTimer on the catch event token advances the process to completion', () => {
    const { state: s0, def } = start('intermediate-timer.bpmn')
    const timerToken = s0.tokens.find(t => t.status === 'waiting')!

    const { newState } = execute(def, { type: 'FireTimer', tokenId: timerToken.id }, s0, opts)
    expect(newState.instance.status).toBe('completed')
  })

  it('process does not complete before FireTimer', () => {
    const { state } = start('intermediate-timer.bpmn')
    expect(state.instance.status).toBe('active')
  })
})

// ─── Intermediate message catch event ─────────────────────────────────────────

describe('ExecutionEngine — intermediate message catch event', () => {
  it('token waits at the message catch event after StartProcess', () => {
    const { state } = start('intermediate-message.bpmn')
    const waiting = state.tokens.filter(t => t.status === 'waiting')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]!.elementId).toBe('msg_catch')
  })

  it('waitingFor is set to message with the message name', () => {
    const { state } = start('intermediate-message.bpmn')
    const token = state.tokens.find(t => t.status === 'waiting')!
    expect(token.waitingFor?.type).toBe('message')
    expect(token.waitingFor?.correlationData?.['messageName']).toBe('OrderShipped')
  })

  it('DeliverMessage with the correct name advances the process to completion', () => {
    const { state: s0, def } = start('intermediate-message.bpmn')

    const { newState } = execute(
      def,
      { type: 'DeliverMessage', messageName: 'OrderShipped' },
      s0,
      opts,
    )
    expect(newState.instance.status).toBe('completed')
  })

  it('DeliverMessage merges variables into the token scope', () => {
    const { state: s0, def } = start('intermediate-message.bpmn')
    const trackingVar = { type: 'string' as const, value: 'TRK-123' }

    const { newState } = execute(
      def,
      { type: 'DeliverMessage', messageName: 'OrderShipped', variables: { tracking: trackingVar } },
      s0,
      opts,
    )
    expect(newState.instance.status).toBe('completed')
    // Verify variable is in scope
    const scope = newState.scopes[0]!
    expect(scope.variables['tracking']).toEqual(trackingVar)
  })

  it('DeliverMessage with wrong name does not advance the process', () => {
    const { state: s0, def } = start('intermediate-message.bpmn')

    const { newState } = execute(
      def,
      { type: 'DeliverMessage', messageName: 'WrongMessage' },
      s0,
      opts,
    )
    expect(newState.instance.status).toBe('active')
    expect(newState.tokens.filter(t => t.status === 'waiting')).toHaveLength(1)
  })
})

// ─── Intermediate signal catch event ──────────────────────────────────────────

describe('ExecutionEngine — intermediate signal catch event', () => {
  it('token waits at the signal catch event after StartProcess', () => {
    const { state } = start('intermediate-signal.bpmn')
    const waiting = state.tokens.filter(t => t.status === 'waiting')
    expect(waiting).toHaveLength(1)
    expect(waiting[0]!.elementId).toBe('sig_catch')
  })

  it('waitingFor is set to signal with the signal name', () => {
    const { state } = start('intermediate-signal.bpmn')
    const token = state.tokens.find(t => t.status === 'waiting')!
    expect(token.waitingFor?.type).toBe('signal')
    expect(token.waitingFor?.correlationData?.['signalName']).toBe('EmergencyStop')
  })

  it('BroadcastSignal with the correct name advances the process to completion', () => {
    const { state: s0, def } = start('intermediate-signal.bpmn')

    const { newState } = execute(
      def,
      { type: 'BroadcastSignal', signalName: 'EmergencyStop' },
      s0,
      opts,
    )
    expect(newState.instance.status).toBe('completed')
  })

  it('BroadcastSignal with wrong name does not advance the process', () => {
    const { state: s0, def } = start('intermediate-signal.bpmn')

    const { newState } = execute(
      def,
      { type: 'BroadcastSignal', signalName: 'OtherSignal' },
      s0,
      opts,
    )
    expect(newState.instance.status).toBe('active')
  })
})

// ─── Boundary timer event — interrupting ──────────────────────────────────────

describe('ExecutionEngine — boundary timer event (interrupting)', () => {
  it('creates a waiting boundary token alongside the host task token', () => {
    const { state } = start('boundary-timer.bpmn')
    const waiting = state.tokens.filter(t => t.status === 'waiting')
    expect(waiting).toHaveLength(2)
    const taskToken = waiting.find(t => t.elementId === 'task_1')
    const boundaryToken = waiting.find(t => t.elementId === 'boundary_timer')
    expect(taskToken).toBeDefined()
    expect(boundaryToken).toBeDefined()
  })

  it('boundary token has waitingFor type timer', () => {
    const { state } = start('boundary-timer.bpmn')
    const boundaryToken = state.tokens.find(t => t.elementId === 'boundary_timer')!
    expect(boundaryToken.waitingFor?.type).toBe('timer')
  })

  it('FireTimer on the boundary token cancels the host task token', () => {
    const { state: s0, def } = start('boundary-timer.bpmn')
    const boundaryToken = s0.tokens.find(t => t.elementId === 'boundary_timer')!

    const { newState } = execute(def, { type: 'FireTimer', tokenId: boundaryToken.id }, s0, opts)
    const taskToken = newState.tokens.find(t => t.elementId === 'task_1')!
    expect(taskToken.status).toBe('cancelled')
  })

  it('process completes via the boundary timeout path', () => {
    const { state: s0, def } = start('boundary-timer.bpmn')
    const boundaryToken = s0.tokens.find(t => t.elementId === 'boundary_timer')!

    const { newState } = execute(def, { type: 'FireTimer', tokenId: boundaryToken.id }, s0, opts)
    expect(newState.instance.status).toBe('completed')
    const endToken = newState.tokens.find(t => t.elementId === 'end_timeout')
    expect(endToken?.status).toBe('completed')
  })

  it('process can still complete via the normal task completion path', () => {
    const { state: s0, def } = start('boundary-timer.bpmn')
    const taskToken = s0.tokens.find(t => t.elementId === 'task_1')!

    const { newState } = execute(
      def,
      { type: 'CompleteUserTask', tokenId: taskToken.id, completedBy: 'user-1' },
      s0,
      opts,
    )
    expect(newState.instance.status).toBe('completed')
    const endToken = newState.tokens.find(t => t.elementId === 'end_ok')
    expect(endToken?.status).toBe('completed')
  })
})

// ─── Boundary timer event — non-interrupting ──────────────────────────────────

describe('ExecutionEngine — boundary timer event (non-interrupting)', () => {
  it('creates a waiting boundary token alongside the host task token', () => {
    const { state } = start('boundary-timer-non-interrupting.bpmn')
    const waiting = state.tokens.filter(t => t.status === 'waiting')
    expect(waiting).toHaveLength(2)
  })

  it('FireTimer on non-interrupting boundary does NOT cancel the host task token', () => {
    const { state: s0, def } = start('boundary-timer-non-interrupting.bpmn')
    const boundaryToken = s0.tokens.find(t => t.elementId === 'boundary_timer')!

    const { newState } = execute(def, { type: 'FireTimer', tokenId: boundaryToken.id }, s0, opts)
    const taskToken = newState.tokens.find(t => t.elementId === 'task_1')!
    expect(taskToken.status).toBe('waiting')
  })

  it('non-interrupting boundary routes a new token through the boundary path', () => {
    const { state: s0, def } = start('boundary-timer-non-interrupting.bpmn')
    const boundaryToken = s0.tokens.find(t => t.elementId === 'boundary_timer')!

    const { newState } = execute(def, { type: 'FireTimer', tokenId: boundaryToken.id }, s0, opts)
    // reminder_task should be waiting (ServiceTask suspends)
    const reminderToken = newState.tokens.find(t => t.elementId === 'reminder_task')
    expect(reminderToken?.status).toBe('waiting')
  })

  it('process completes only after both paths finish', () => {
    const { state: s0, def } = start('boundary-timer-non-interrupting.bpmn')
    const boundaryToken = s0.tokens.find(t => t.elementId === 'boundary_timer')!
    const taskToken = s0.tokens.find(t => t.elementId === 'task_1')!

    // Fire boundary timer — reminder path starts
    const { newState: s1 } = execute(def, { type: 'FireTimer', tokenId: boundaryToken.id }, s0, opts)
    // Complete the reminder service task
    const reminderToken = s1.tokens.find(t => t.elementId === 'reminder_task')!
    const { newState: s2 } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: reminderToken.id },
      s1,
      opts,
    )
    // Reminder path ended but user task still alive
    expect(s2.instance.status).toBe('active')

    // Complete the user task
    const { newState: s3 } = execute(
      def,
      { type: 'CompleteUserTask', tokenId: taskToken.id, completedBy: 'user-1' },
      s2,
      opts,
    )
    expect(s3.instance.status).toBe('completed')
  })
})
