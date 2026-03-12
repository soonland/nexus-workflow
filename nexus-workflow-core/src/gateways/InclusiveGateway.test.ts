import { describe, it, expect } from 'vitest'
import { DefinitionError, RuntimeError } from '../model/errors.js'
import type { SequenceFlow, InclusiveGatewayJoinState } from '../model/types.js'
import { evaluateInclusiveSplit, evaluateInclusiveJoin } from './InclusiveGateway.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function conditional(id: string, condition: string): SequenceFlow {
  return { id, sourceRef: 'gw', targetRef: `target_${id}`, conditionExpression: condition }
}

function defaultFlow(id: string): SequenceFlow {
  return { id, sourceRef: 'gw', targetRef: `target_${id}`, isDefault: true }
}

function stubEvaluator(results: Record<string, boolean>) {
  return (expression: string): boolean => {
    if (!(expression in results)) throw new Error(`Unexpected expression: "${expression}"`)
    return results[expression]!
  }
}

function joinState(
  activatedIncomingFlows: string[],
  arrivedFromFlows: string[],
  overrides: Partial<InclusiveGatewayJoinState> = {},
): InclusiveGatewayJoinState {
  return {
    gatewayId: 'gw_join',
    instanceId: 'inst-1',
    activationId: 'act-1',
    activatedIncomingFlows,
    arrivedFromFlows,
    ...overrides,
  }
}

// ─── Split ────────────────────────────────────────────────────────────────────

describe('InclusiveGateway — split', () => {
  describe('condition evaluation', () => {
    it('activates all flows whose conditions are true', () => {
      const outgoing = [
        conditional('flow_a', 'x > 0'),
        conditional('flow_b', 'y > 0'),
        conditional('flow_c', 'z > 0'),
      ]
      const evaluate = stubEvaluator({ 'x > 0': true, 'y > 0': false, 'z > 0': true })

      const { activatedFlowIds } = evaluateInclusiveSplit('gw_1', outgoing, undefined, evaluate)

      expect(activatedFlowIds).toEqual(['flow_a', 'flow_c'])
    })

    it('activates only one flow when a single condition is true', () => {
      const outgoing = [
        conditional('flow_a', 'x > 0'),
        conditional('flow_b', 'y > 0'),
        conditional('flow_c', 'z > 0'),
      ]
      const evaluate = stubEvaluator({ 'x > 0': false, 'y > 0': true, 'z > 0': false })

      const { activatedFlowIds } = evaluateInclusiveSplit('gw_1', outgoing, undefined, evaluate)

      expect(activatedFlowIds).toEqual(['flow_b'])
    })

    it('activates all flows when all conditions are true', () => {
      const outgoing = [
        conditional('flow_a', 'a'),
        conditional('flow_b', 'b'),
        conditional('flow_c', 'c'),
      ]
      const evaluate = stubEvaluator({ a: true, b: true, c: true })

      const { activatedFlowIds } = evaluateInclusiveSplit('gw_1', outgoing, undefined, evaluate)

      expect(activatedFlowIds).toEqual(['flow_a', 'flow_b', 'flow_c'])
    })

    it('evaluates all flows regardless of earlier matches (unlike XOR)', () => {
      const called: string[] = []
      const outgoing = [
        conditional('flow_a', 'expr_a'),
        conditional('flow_b', 'expr_b'),
        conditional('flow_c', 'expr_c'),
      ]
      const evaluate = (expr: string): boolean => {
        called.push(expr)
        return true
      }

      evaluateInclusiveSplit('gw_1', outgoing, undefined, evaluate)

      expect(called).toEqual(['expr_a', 'expr_b', 'expr_c'])
    })
  })

  describe('default flow', () => {
    it('activates the default flow when no condition is true', () => {
      const outgoing = [
        conditional('flow_a', 'x > 0'),
        conditional('flow_b', 'y > 0'),
        defaultFlow('flow_default'),
      ]
      const evaluate = stubEvaluator({ 'x > 0': false, 'y > 0': false })

      const { activatedFlowIds } = evaluateInclusiveSplit('gw_1', outgoing, 'flow_default', evaluate)

      expect(activatedFlowIds).toEqual(['flow_default'])
    })

    it('does not activate the default flow when at least one condition is true', () => {
      const outgoing = [
        conditional('flow_a', 'x > 0'),
        defaultFlow('flow_default'),
      ]
      const evaluate = stubEvaluator({ 'x > 0': true })

      const { activatedFlowIds } = evaluateInclusiveSplit('gw_1', outgoing, 'flow_default', evaluate)

      expect(activatedFlowIds).not.toContain('flow_default')
      expect(activatedFlowIds).toContain('flow_a')
    })

    it('does not evaluate the condition expression on the default flow', () => {
      const called: string[] = []
      const outgoing = [
        conditional('flow_a', 'expr_a'),
        defaultFlow('flow_default'),
      ]
      const evaluate = (expr: string): boolean => {
        called.push(expr)
        return false
      }

      evaluateInclusiveSplit('gw_1', outgoing, 'flow_default', evaluate)

      expect(called).toEqual(['expr_a'])
    })
  })

  describe('error handling', () => {
    it('throws DefinitionError when no condition matches and there is no default flow', () => {
      const outgoing = [
        conditional('flow_a', 'x > 0'),
        conditional('flow_b', 'y > 0'),
      ]
      const evaluate = stubEvaluator({ 'x > 0': false, 'y > 0': false })

      expect(() =>
        evaluateInclusiveSplit('gw_1', outgoing, undefined, evaluate),
      ).toThrow(DefinitionError)
    })

    it('includes the gateway id in the DefinitionError', () => {
      const outgoing = [conditional('flow_a', 'false_expr')]
      const evaluate = stubEvaluator({ false_expr: false })

      expect(() =>
        evaluateInclusiveSplit('gw_or_55', outgoing, undefined, evaluate),
      ).toThrow(expect.objectContaining({ message: expect.stringContaining('gw_or_55') }))
    })

    it('throws RuntimeError when there are no outgoing flows', () => {
      expect(() =>
        evaluateInclusiveSplit('gw_1', [], undefined, () => false),
      ).toThrow(RuntimeError)
    })
  })
})

// ─── Join ─────────────────────────────────────────────────────────────────────

describe('InclusiveGateway — join', () => {
  describe('fires based on activated paths only', () => {
    it('fires immediately when only 1 of 3 paths was activated and it arrives', () => {
      // Split activated only flow_b — join must fire on flow_b arrival alone
      const state = joinState(['flow_b'], [])

      const result = evaluateInclusiveJoin('gw_join', 'flow_b', state)

      expect(result.fires).toBe(true)
    })

    it('does not fire when 1 of 2 activated paths has arrived', () => {
      const state = joinState(['flow_a', 'flow_b'], [])

      const result = evaluateInclusiveJoin('gw_join', 'flow_a', state)

      expect(result.fires).toBe(false)
    })

    it('fires when both of 2 activated paths have arrived', () => {
      const state = joinState(['flow_a', 'flow_b'], ['flow_a'])

      const result = evaluateInclusiveJoin('gw_join', 'flow_b', state)

      expect(result.fires).toBe(true)
    })

    it('fires when all 3 activated paths have arrived', () => {
      const state = joinState(['flow_a', 'flow_b', 'flow_c'], ['flow_a', 'flow_b'])

      const result = evaluateInclusiveJoin('gw_join', 'flow_c', state)

      expect(result.fires).toBe(true)
    })

    it('does not fire when only 2 of 3 activated paths have arrived', () => {
      const state = joinState(['flow_a', 'flow_b', 'flow_c'], ['flow_a'])

      const result = evaluateInclusiveJoin('gw_join', 'flow_b', state)

      expect(result.fires).toBe(false)
    })
  })

  describe('updated state', () => {
    it('returns updated arrivedFromFlows with the new flow included', () => {
      const state = joinState(['flow_a', 'flow_b'], [])

      const result = evaluateInclusiveJoin('gw_join', 'flow_a', state)

      expect(result.updatedState.arrivedFromFlows).toContain('flow_a')
    })

    it('does not mutate the original state', () => {
      const state = joinState(['flow_a', 'flow_b'], ['flow_a'])
      const originalArrived = [...state.arrivedFromFlows]

      evaluateInclusiveJoin('gw_join', 'flow_b', state)

      expect(state.arrivedFromFlows).toEqual(originalArrived)
    })
  })

  describe('non-activated paths never contribute', () => {
    it('does not fire when an unexpected flow arrives for an activation of 1', () => {
      // flow_a was activated; flow_c was not (it was not on the split path)
      const state = joinState(['flow_a'], [])

      // flow_c arrives — possibly from a modeling error or a loopback
      const result = evaluateInclusiveJoin('gw_join', 'flow_c', state)

      // flow_c is not in activatedIncomingFlows, so it cannot satisfy the join
      expect(result.fires).toBe(false)
    })

    it('fires when the single activated flow arrives regardless of other arrivals', () => {
      // Only flow_a was activated at split time.
      // flow_c already arrived (unexpected), flow_a now arrives.
      const state = joinState(['flow_a'], ['flow_c'])

      const result = evaluateInclusiveJoin('gw_join', 'flow_a', state)

      expect(result.fires).toBe(true)
    })
  })
})
