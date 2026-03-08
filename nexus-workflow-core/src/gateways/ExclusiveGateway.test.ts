import { describe, it, expect } from 'vitest'
import { evaluateExclusiveSplit } from './ExclusiveGateway.js'
import { DefinitionError, RuntimeError } from '../model/errors.js'
import type { SequenceFlow } from '../model/types.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Evaluator stub: maps expression strings to boolean results. */
function stubEvaluator(results: Record<string, boolean>) {
  return (expression: string): boolean => {
    if (!(expression in results)) throw new Error(`Unexpected expression: "${expression}"`)
    return results[expression]!
  }
}

const flows = {
  unconditional: (id: string, source = 'gw'): SequenceFlow => ({
    id,
    sourceRef: source,
    targetRef: `target_${id}`,
  }),
  conditional: (id: string, condition: string, source = 'gw'): SequenceFlow => ({
    id,
    sourceRef: source,
    targetRef: `target_${id}`,
    conditionExpression: condition,
  }),
  default: (id: string, source = 'gw'): SequenceFlow => ({
    id,
    sourceRef: source,
    targetRef: `target_${id}`,
    isDefault: true,
  }),
}

// ─── Split ────────────────────────────────────────────────────────────────────

describe('ExclusiveGateway — split', () => {
  describe('condition evaluation', () => {
    it('selects the first flow whose condition is true', () => {
      const outgoing = [
        flows.conditional('flow_a', 'amount > 100'),
        flows.conditional('flow_b', 'amount <= 100'),
      ]
      const evaluate = stubEvaluator({ 'amount > 100': true, 'amount <= 100': false })

      const selected = evaluateExclusiveSplit('gw_1', outgoing, undefined, evaluate)

      expect(selected).toBe('flow_a')
    })

    it('selects the second flow when the first condition is false', () => {
      const outgoing = [
        flows.conditional('flow_a', 'amount > 100'),
        flows.conditional('flow_b', 'amount <= 100'),
      ]
      const evaluate = stubEvaluator({ 'amount > 100': false, 'amount <= 100': true })

      const selected = evaluateExclusiveSplit('gw_1', outgoing, undefined, evaluate)

      expect(selected).toBe('flow_b')
    })

    it('evaluates flows in declaration order and stops at first match', () => {
      const called: string[] = []
      const outgoing = [
        flows.conditional('flow_a', 'expr_a'),
        flows.conditional('flow_b', 'expr_b'),
        flows.conditional('flow_c', 'expr_c'),
      ]
      const evaluate = (expr: string): boolean => {
        called.push(expr)
        return expr === 'expr_b'
      }

      evaluateExclusiveSplit('gw_1', outgoing, undefined, evaluate)

      expect(called).toEqual(['expr_a', 'expr_b']) // expr_c never evaluated
    })

    it('selects the default flow when no condition matches', () => {
      const outgoing = [
        flows.conditional('flow_a', 'amount > 100'),
        flows.default('flow_default'),
      ]
      const evaluate = stubEvaluator({ 'amount > 100': false })

      const selected = evaluateExclusiveSplit('gw_1', outgoing, 'flow_default', evaluate)

      expect(selected).toBe('flow_default')
    })

    it('does not evaluate the condition on the default flow', () => {
      const called: string[] = []
      const outgoing = [
        flows.conditional('flow_a', 'expr_a'),
        flows.default('flow_default'),
      ]
      const evaluate = (expr: string): boolean => {
        called.push(expr)
        return false
      }

      evaluateExclusiveSplit('gw_1', outgoing, 'flow_default', evaluate)

      expect(called).toEqual(['expr_a']) // default flow never evaluated
    })

    it('skips an unconditional non-default flow (treated as always-true)', () => {
      // An unconditional flow with no condition expression always matches
      const outgoing = [
        flows.conditional('flow_a', 'amount > 100'),
        flows.unconditional('flow_b'),
      ]
      const evaluate = stubEvaluator({ 'amount > 100': false })

      const selected = evaluateExclusiveSplit('gw_1', outgoing, undefined, evaluate)

      expect(selected).toBe('flow_b')
    })
  })

  describe('error handling', () => {
    it('throws DefinitionError when no condition matches and there is no default flow', () => {
      const outgoing = [
        flows.conditional('flow_a', 'amount > 100'),
        flows.conditional('flow_b', 'amount > 200'),
      ]
      const evaluate = stubEvaluator({ 'amount > 100': false, 'amount > 200': false })

      expect(() =>
        evaluateExclusiveSplit('gw_1', outgoing, undefined, evaluate),
      ).toThrow(DefinitionError)
    })

    it('includes the gateway id in the DefinitionError', () => {
      const outgoing = [flows.conditional('flow_a', 'false_expr')]
      const evaluate = stubEvaluator({ false_expr: false })

      expect(() =>
        evaluateExclusiveSplit('gw_xor_42', outgoing, undefined, evaluate),
      ).toThrow(expect.objectContaining({ message: expect.stringContaining('gw_xor_42') }))
    })

    it('throws RuntimeError when there are no outgoing flows at all', () => {
      expect(() =>
        evaluateExclusiveSplit('gw_1', [], undefined, () => false),
      ).toThrow(RuntimeError)
    })
  })

  describe('edge cases', () => {
    it('handles a single unconditional outgoing flow (pass-through split)', () => {
      const outgoing = [flows.unconditional('flow_only')]

      const selected = evaluateExclusiveSplit('gw_1', outgoing, undefined, () => false)

      expect(selected).toBe('flow_only')
    })

    it('handles a single conditional flow that matches', () => {
      const outgoing = [flows.conditional('flow_a', 'x > 0')]
      const evaluate = stubEvaluator({ 'x > 0': true })

      const selected = evaluateExclusiveSplit('gw_1', outgoing, undefined, evaluate)

      expect(selected).toBe('flow_a')
    })

    it('returns only one flow even when multiple conditions would be true', () => {
      // XOR semantics: first match wins
      const outgoing = [
        flows.conditional('flow_a', 'x > 0'),
        flows.conditional('flow_b', 'x > 0'), // also true, but should not be reached
      ]
      const called: string[] = []
      const evaluate = (expr: string): boolean => {
        called.push(expr)
        return true
      }

      const selected = evaluateExclusiveSplit('gw_1', outgoing, undefined, evaluate)

      expect(selected).toBe('flow_a')
      expect(called).toHaveLength(1) // stopped after first match
    })
  })
})
