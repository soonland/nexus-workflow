import { describe, it, expect, beforeEach } from 'vitest'
import {
  buildParallelGatewayDefinition,
  buildServiceTaskDefinition,
  buildSimpleSequenceDefinition,
  buildUserTaskDefinition,
  buildXorGatewayDefinition,
} from '../../tests/fixtures/builders/ProcessDefinitionBuilder.js'
import type { ProcessDefinition, HistoryEntry } from '../model/types.js'
import { deriveHistory, MAX_SNAPSHOT_BYTES } from './deriveHistory.js'
import { execute, type EngineCommand, type EngineState } from './ExecutionEngine.js'

// Runs commands through the real engine, deriving the history of each cycle the way the app does.

let ids: number
let clock: number
const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, seconds))
const options = { generateId: () => `id-${++ids}`, now: () => at(clock) }

beforeEach(() => {
  ids = 0
  clock = 0
})

function run(definition: ProcessDefinition, steps: Array<{ command: EngineCommand; atSecond: number }>) {
  ids = 0 // every run numbers its tokens the same way, so a probe run can name the tokens of the real one
  let state: EngineState | null = null
  const cycles: Array<{ state: EngineState; entries: HistoryEntry[] }> = []
  for (const { command, atSecond } of steps) {
    clock = atSecond
    const result = execute(definition, command, state, options)
    cycles.push({ state: result.newState, entries: deriveHistory(state, result.newState, result.events) })
    state = result.newState
  }
  return cycles
}

const summary = (entries: HistoryEntry[]) => entries.map((e) => `${e.elementId}:${e.status}`)
const waitingToken = (state: EngineState) => state.tokens.find((t) => t.status === 'waiting')!

describe('deriveHistory', () => {
  it('writes one entry per element of a process that runs straight through', () => {
    const [cycle] = run(buildSimpleSequenceDefinition(), [{ command: { type: 'StartProcess' }, atSecond: 5 }])

    expect(summary(cycle!.entries)).toEqual(['start_1:completed', 'end_1:completed'])
    for (const entry of cycle!.entries) {
      expect(entry.instanceId).toBe(cycle!.state.instance.id)
      expect(entry.completedAt).toEqual(at(5))
      expect(entry.startedAt).toEqual(at(5)) // passed through in the same instant
    }
  })

  it('names the element type, and uses the token as the entry id (every visit is its own token)', () => {
    const [cycle] = run(buildSimpleSequenceDefinition(), [{ command: { type: 'StartProcess' }, atSecond: 5 }])

    expect(cycle!.entries.map((e) => e.elementType)).toEqual(['startEvent', 'endEvent'])
    for (const entry of cycle!.entries) expect(entry.id).toBe(entry.tokenId)
  })

  it('gives every entry its own id', () => {
    const [cycle] = run(buildSimpleSequenceDefinition(), [{ command: { type: 'StartProcess' }, atSecond: 5 }])

    const idsSeen = cycle!.entries.map((e) => e.id)
    expect(new Set(idsSeen).size).toBe(idsSeen.length)
  })

  it('writes the elements passed so far, and the task only once it is done, with how long it took', () => {
    const def = buildUserTaskDefinition()
    const [started, completed] = (() => {
      const first = run(def, [{ command: { type: 'StartProcess' }, atSecond: 10 }])
      const tokenId = waitingToken(first[0]!.state).id
      const both = run(def, [
        { command: { type: 'StartProcess' }, atSecond: 10 },
        { command: { type: 'CompleteUserTask', tokenId, completedBy: 'ada' }, atSecond: 70 },
      ])
      return both
    })()

    expect(summary(started!.entries)).toEqual(['start_1:completed']) // the task is still open: nothing yet
    const task = completed!.entries.find((e) => e.elementId === 'task_1')!
    expect(summary(completed!.entries)).toEqual(['task_1:completed', 'end_1:completed'])
    expect(task.startedAt).toEqual(at(10)) // it arrived in the first cycle
    expect(task.completedAt).toEqual(at(70))
    expect(task.completedAt.getTime() - task.startedAt.getTime()).toBe(60_000)
  })

  it('does not write an element twice across cycles', () => {
    const def = buildUserTaskDefinition()
    const first = run(def, [{ command: { type: 'StartProcess' }, atSecond: 10 }])
    const tokenId = waitingToken(first[0]!.state).id
    const cycles = run(def, [
      { command: { type: 'StartProcess' }, atSecond: 10 },
      { command: { type: 'CompleteUserTask', tokenId, completedBy: 'ada' }, atSecond: 70 },
    ])

    const all = cycles.flatMap((c) => c.entries)
    expect(summary(all)).toEqual(['start_1:completed', 'task_1:completed', 'end_1:completed'])
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length)
  })

  it('covers a service task finished later by a worker', () => {
    const def = buildServiceTaskDefinition('send-email')
    const probe = run(def, [{ command: { type: 'StartProcess' }, atSecond: 1 }])
    const tokenId = waitingToken(probe[0]!.state).id

    const cycles = run(def, [
      { command: { type: 'StartProcess' }, atSecond: 1 },
      { command: { type: 'CompleteServiceTask', tokenId }, atSecond: 4 },
    ])

    const task = cycles[1]!.entries.find((e) => e.elementType === 'serviceTask')!
    expect(task.status).toBe('completed')
    expect(task.completedAt.getTime() - task.startedAt.getTime()).toBe(3000)
  })

  it('lists a gateway the instance passed through, once, and only the branch taken', () => {
    const [cycle] = run(buildXorGatewayDefinition(), [{ command: { type: 'StartProcess', variables: { amount: { type: 'number', value: 5 } } }, atSecond: 3 }])

    const elements = cycle!.entries.map((e) => e.elementId)
    const gateways = cycle!.entries.filter((e) => e.elementType.endsWith('Gateway'))
    expect(gateways).toHaveLength(1)
    expect(elements[0]).toBe('start_1')
    expect(new Set(elements).size).toBe(elements.length)
  })

  it('writes a parallel gateway once for the split, and once for each branch that arrives at the join', () => {
    const def = buildParallelGatewayDefinition()
    const [started] = run(def, [{ command: { type: 'StartProcess' }, atSecond: 1 }])
    const tokens = started!.state.tokens.filter((t) => t.status === 'waiting')
    expect(tokens).toHaveLength(3)

    const cycles = run(def, [
      { command: { type: 'StartProcess' }, atSecond: 1 },
      ...tokens.map((t, i) => ({ command: { type: 'CompleteServiceTask', tokenId: t.id } as EngineCommand, atSecond: 2 + i })),
    ])

    const all = cycles.flatMap((c) => c.entries)
    expect(all.filter((e) => e.elementId === 'gw_split')).toHaveLength(1) // one token left the split, three were created
    expect(all.filter((e) => e.elementType === 'serviceTask')).toHaveLength(3)
    const arrivals = all.filter((e) => e.elementId === 'gw_join')
    expect(arrivals).toHaveLength(3)
    expect(arrivals.map((e) => e.completedAt)).toEqual([at(2), at(3), at(4)]) // each when its branch got there
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length)
  })

  it('marks the element a cancelled instance was waiting at as cancelled', () => {
    const def = buildUserTaskDefinition()
    const cycles = run(def, [
      { command: { type: 'StartProcess' }, atSecond: 10 },
      { command: { type: 'CancelInstance' }, atSecond: 90 },
    ])

    const cancelled = cycles[1]!.entries
    expect(summary(cancelled)).toEqual(['task_1:cancelled'])
    expect(cancelled[0]?.startedAt).toEqual(at(10))
    expect(cancelled[0]?.completedAt).toEqual(at(90))
  })

  it('calls a visit that threw an error an error, whatever became of its token', () => {
    const def = buildUserTaskDefinition()
    const [started] = run(def, [{ command: { type: 'StartProcess' }, atSecond: 1 }])
    const tokenId = waitingToken(started!.state).id
    clock = 9
    const cancelled = execute(def, { type: 'CancelInstance' }, started!.state, options)

    const entries = deriveHistory(started!.state, cancelled.newState, [
      ...cancelled.events,
      { type: 'ErrorThrown', instanceId: cancelled.newState.instance.id, tokenId, errorCode: 'PAYMENT_FAILED', caught: true },
    ])

    expect(summary(entries)).toEqual(['task_1:error'])
  })

  it('writes nothing for a cycle in which nothing finished (suspending)', () => {
    const def = buildUserTaskDefinition()
    const cycles = run(def, [
      { command: { type: 'StartProcess' }, atSecond: 1 },
      { command: { type: 'SuspendInstance' }, atSecond: 2 },
    ])

    expect(cycles[1]!.entries).toEqual([])
  })

  describe('variables snapshot', () => {
    it('keeps the variables as they stand when the element finishes', () => {
      const def = buildUserTaskDefinition()
      const probe = run(def, [{ command: { type: 'StartProcess', variables: { amount: { type: 'number', value: 120 } } }, atSecond: 1 }])
      const tokenId = waitingToken(probe[0]!.state).id

      const cycles = run(def, [
        { command: { type: 'StartProcess', variables: { amount: { type: 'number', value: 120 } } }, atSecond: 1 },
        { command: { type: 'CompleteUserTask', tokenId, completedBy: 'ada', outputVariables: { approved: { type: 'boolean', value: true } } }, atSecond: 5 },
      ])

      const task = cycles[1]!.entries.find((e) => e.elementId === 'task_1')!
      expect(task.variablesSnapshot).toEqual({ amount: { type: 'number', value: 120 }, approved: { type: 'boolean', value: true } })
      expect(cycles[0]!.entries[0]?.variablesSnapshot).toEqual({ amount: { type: 'number', value: 120 } })
    })

    it('is left out when there are no variables', () => {
      const [cycle] = run(buildSimpleSequenceDefinition(), [{ command: { type: 'StartProcess' }, atSecond: 1 }])
      expect(cycle!.entries[0]).not.toHaveProperty('variablesSnapshot')
    })

    it('is left out, with the entry still written, when it would be too big', () => {
      const big = 'x'.repeat(MAX_SNAPSHOT_BYTES + 10)
      const [cycle] = run(buildSimpleSequenceDefinition(), [{ command: { type: 'StartProcess', variables: { blob: { type: 'string', value: big } } }, atSecond: 1 }])

      expect(summary(cycle!.entries)).toEqual(['start_1:completed', 'end_1:completed'])
      expect(cycle!.entries.every((e) => !('variablesSnapshot' in e))).toBe(true)
    })

    it('does not share the object with the engine state (a later change cannot rewrite history)', () => {
      const [cycle] = run(buildSimpleSequenceDefinition(), [{ command: { type: 'StartProcess', variables: { a: { type: 'number', value: 1 } } }, atSecond: 1 }])
      const snapshot = cycle!.entries[0]!.variablesSnapshot!

      cycle!.state.scopes[0]!.variables['a'] = { type: 'number', value: 999 }

      expect(snapshot['a']).toEqual({ type: 'number', value: 1 })
    })
  })

  it('does not change the states it is given', () => {
    const def = buildUserTaskDefinition()
    const first = execute(def, { type: 'StartProcess' }, null, options)
    const before = JSON.stringify(first.newState)
    const result = execute(def, { type: 'CancelInstance' }, first.newState, options)

    deriveHistory(first.newState, result.newState, result.events)

    expect(JSON.stringify(first.newState)).toBe(before)
  })
})
