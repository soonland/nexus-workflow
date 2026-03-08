import { describe, it, expect } from 'vitest'
import { evaluateParallelSplit, evaluateParallelJoin } from './ParallelGateway.js'
import { RuntimeError } from '../model/errors.js'
import type { SequenceFlow, ParallelGatewayJoinState } from '../model/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flow(id: string, source = 'gw'): SequenceFlow {
  return { id, sourceRef: source, targetRef: `target_${id}` }
}

function joinState(
  arrivedFromFlows: string[],
  expectedFlows: string[],
  overrides: Partial<ParallelGatewayJoinState> = {},
): ParallelGatewayJoinState {
  return {
    gatewayId: 'gw_join',
    instanceId: 'inst-1',
    activationId: 'act-1',
    arrivedFromFlows,
    expectedFlows,
    ...overrides,
  }
}

// ─── Split ────────────────────────────────────────────────────────────────────

describe('ParallelGateway — split', () => {
  it('activates all outgoing flows simultaneously', () => {
    const outgoing = [flow('flow_a'), flow('flow_b'), flow('flow_c')]

    const selected = evaluateParallelSplit('gw_1', outgoing)

    expect(selected).toEqual(['flow_a', 'flow_b', 'flow_c'])
  })

  it('preserves declaration order of outgoing flows', () => {
    const outgoing = [flow('flow_c'), flow('flow_a'), flow('flow_b')]

    const selected = evaluateParallelSplit('gw_1', outgoing)

    expect(selected).toEqual(['flow_c', 'flow_a', 'flow_b'])
  })

  it('activates a single outgoing flow (degenerate split)', () => {
    const outgoing = [flow('flow_only')]

    const selected = evaluateParallelSplit('gw_1', outgoing)

    expect(selected).toEqual(['flow_only'])
  })

  it('throws RuntimeError when there are no outgoing flows', () => {
    expect(() => evaluateParallelSplit('gw_1', [])).toThrow(RuntimeError)
  })

  it('includes the gateway id in the RuntimeError', () => {
    expect(() => evaluateParallelSplit('gw_and_99', [])).toThrow(
      expect.objectContaining({ message: expect.stringContaining('gw_and_99') }),
    )
  })
})

// ─── Join ─────────────────────────────────────────────────────────────────────

describe('ParallelGateway — join', () => {
  describe('basic synchronisation', () => {
    it('does not fire when only 1 of 3 branches has arrived', () => {
      const state = joinState(['flow_a'], ['flow_a', 'flow_b', 'flow_c'])

      const result = evaluateParallelJoin('gw_join', 'flow_a', state)

      expect(result.fires).toBe(false)
    })

    it('does not fire when 2 of 3 branches have arrived', () => {
      const state = joinState(['flow_a', 'flow_b'], ['flow_a', 'flow_b', 'flow_c'])

      const result = evaluateParallelJoin('gw_join', 'flow_b', state)

      expect(result.fires).toBe(false)
    })

    it('fires when the last expected branch arrives', () => {
      const state = joinState(['flow_a', 'flow_b'], ['flow_a', 'flow_b', 'flow_c'])

      const result = evaluateParallelJoin('gw_join', 'flow_c', state)

      expect(result.fires).toBe(true)
    })

    it('fires immediately when a 1-branch join receives its token', () => {
      const state = joinState([], ['flow_only'])

      const result = evaluateParallelJoin('gw_join', 'flow_only', state)

      expect(result.fires).toBe(true)
    })
  })

  describe('updated state', () => {
    it('returns updated arrivedFromFlows with the new flow appended', () => {
      const state = joinState(['flow_a'], ['flow_a', 'flow_b', 'flow_c'])

      const result = evaluateParallelJoin('gw_join', 'flow_b', state)

      expect(result.updatedState.arrivedFromFlows).toContain('flow_b')
      expect(result.updatedState.arrivedFromFlows).toContain('flow_a')
    })

    it('does not mutate the original state', () => {
      const state = joinState(['flow_a'], ['flow_a', 'flow_b'])
      const originalArrived = [...state.arrivedFromFlows]

      evaluateParallelJoin('gw_join', 'flow_b', state)

      expect(state.arrivedFromFlows).toEqual(originalArrived)
    })
  })

  describe('flow tracking by ID, not count', () => {
    it('does not fire when the same flow arrives twice (loop scenario)', () => {
      // Branch A loops back and delivers flow_a a second time.
      // The join must not count it as satisfying flow_b or flow_c.
      const state = joinState(['flow_a'], ['flow_a', 'flow_b', 'flow_c'])

      const result = evaluateParallelJoin('gw_join', 'flow_a', state)

      expect(result.fires).toBe(false)
    })

    it('records a duplicate arrival without changing the satisfied set', () => {
      const state = joinState(['flow_a'], ['flow_a', 'flow_b', 'flow_c'])

      const result = evaluateParallelJoin('gw_join', 'flow_a', state)

      // Still only flow_a in the set — not duplicated
      const arrivedSet = new Set(result.updatedState.arrivedFromFlows)
      expect(arrivedSet.size).toBe(1)
      expect(arrivedSet.has('flow_a')).toBe(true)
    })
  })

  describe('exact completion check', () => {
    it('fires exactly once — when arrivedFromFlows equals expectedFlows', () => {
      const state = joinState(['flow_a', 'flow_b'], ['flow_a', 'flow_b', 'flow_c'])

      const notYet = evaluateParallelJoin('gw_join', 'flow_b', state)
      expect(notYet.fires).toBe(false)

      const fires = evaluateParallelJoin('gw_join', 'flow_c', notYet.updatedState)
      expect(fires.fires).toBe(true)
    })

    it('does not care about the order flows arrive', () => {
      const expected = ['flow_a', 'flow_b', 'flow_c']

      // Arrive in reverse order
      let state = joinState([], expected)
      state = evaluateParallelJoin('gw_join', 'flow_c', state).updatedState
      state = evaluateParallelJoin('gw_join', 'flow_b', state).updatedState
      const result = evaluateParallelJoin('gw_join', 'flow_a', state)

      expect(result.fires).toBe(true)
    })
  })
})
