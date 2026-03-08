import { describe, it, expect } from 'vitest'
import { JsEvaluator } from './JsEvaluator.js'
import {
  SandboxViolationError,
  EvaluationTimeoutError,
  ExpressionSyntaxError,
} from '../model/errors.js'
import type { ExpressionContext } from '../interfaces/ExpressionEvaluator.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ctx(vars: Record<string, unknown> = {}): ExpressionContext {
  return {
    variables: Object.fromEntries(
      Object.entries(vars).map(([k, v]) => {
        const type =
          v === null ? 'null'
          : Array.isArray(v) ? 'array'
          : typeof v === 'object' ? 'object'
          : (typeof v as 'string' | 'number' | 'boolean')
        return [k, { type, value: v }]
      }),
    ),
  }
}

const evaluator = new JsEvaluator()

// ─── Basic evaluation ─────────────────────────────────────────────────────────

describe('JsEvaluator — basic evaluation', () => {
  it.each([
    { expr: '1 + 1',                  vars: {},             expected: 2,     label: 'arithmetic' },
    { expr: 'x > 10',                 vars: { x: 15 },      expected: true,  label: 'comparison true' },
    { expr: 'x > 10',                 vars: { x: 5 },       expected: false, label: 'comparison false' },
    { expr: 'x + y',                  vars: { x: 3, y: 4 }, expected: 7,     label: 'two variables' },
    { expr: 'status === "approved"',  vars: { status: 'approved' }, expected: true, label: 'string equality' },
    { expr: 'active && score > 50',   vars: { active: true, score: 75 }, expected: true, label: 'logical and' },
    { expr: 'active || score > 50',   vars: { active: false, score: 75 }, expected: true, label: 'logical or' },
    { expr: '!active',                vars: { active: false }, expected: true, label: 'logical not' },
    { expr: 'amount >= 100',          vars: { amount: 100 }, expected: true, label: 'gte boundary' },
    { expr: 'amount >= 100',          vars: { amount: 99 },  expected: false, label: 'gte miss' },
  ])('evaluates $label correctly', ({ expr, vars, expected }) => {
    expect(evaluator.evaluate(expr, ctx(vars))).toBe(expected)
  })

  it('returns the result of a ternary expression', () => {
    expect(evaluator.evaluate('x > 0 ? "positive" : "non-positive"', ctx({ x: 5 }))).toBe('positive')
  })

  it('can access nested object properties', () => {
    expect(evaluator.evaluate('order.amount > 100', ctx({ order: { amount: 200 } }))).toBe(true)
  })

  it('returns null for null variables', () => {
    expect(evaluator.evaluate('value === null', ctx({ value: null }))).toBe(true)
  })
})

// ─── Sandbox enforcement ──────────────────────────────────────────────────────

describe('JsEvaluator — sandbox enforcement', () => {
  it('throws SandboxViolationError for process.env access', () => {
    expect(() => evaluator.evaluate('process.env.SECRET', ctx()))
      .toThrow(SandboxViolationError)
  })

  it('throws SandboxViolationError for require()', () => {
    expect(() => evaluator.evaluate('require("fs")', ctx()))
      .toThrow(SandboxViolationError)
  })

  it('throws SandboxViolationError for globalThis access', () => {
    expect(() => evaluator.evaluate('globalThis.process', ctx()))
      .toThrow(SandboxViolationError)
  })

  it('throws SandboxViolationError for global access', () => {
    expect(() => evaluator.evaluate('global.process', ctx()))
      .toThrow(SandboxViolationError)
  })

  it('throws SandboxViolationError for __proto__ access', () => {
    expect(() => evaluator.evaluate('({}).__proto__', ctx()))
      .toThrow(SandboxViolationError)
  })

  it('throws SandboxViolationError for prototype chain access', () => {
    expect(() => evaluator.evaluate('({}).constructor.prototype', ctx()))
      .toThrow(SandboxViolationError)
  })

  it('throws SandboxViolationError for constructor-based code execution', () => {
    expect(() =>
      evaluator.evaluate('[].constructor.constructor("return process")()', ctx()),
    ).toThrow(SandboxViolationError)
  })

  it('throws SandboxViolationError for eval()', () => {
    expect(() => evaluator.evaluate('eval("1 + 1")', ctx()))
      .toThrow(SandboxViolationError)
  })

  it('throws SandboxViolationError for Function constructor', () => {
    expect(() => evaluator.evaluate('new Function("return process")()', ctx()))
      .toThrow(SandboxViolationError)
  })

  it('throws SandboxViolationError for setTimeout', () => {
    expect(() => evaluator.evaluate('setTimeout(() => {}, 0)', ctx()))
      .toThrow(SandboxViolationError)
  })

  it('includes the offending expression in the SandboxViolationError', () => {
    expect(() => evaluator.evaluate('process.env', ctx())).toThrow(
      expect.objectContaining({ expression: 'process.env' }),
    )
  })
})

// ─── Timeout enforcement ──────────────────────────────────────────────────────

describe('JsEvaluator — timeout enforcement', () => {
  it('throws EvaluationTimeoutError for an infinite loop', () => {
    const shortTimeout = new JsEvaluator({ timeoutMs: 50 })
    expect(() => shortTimeout.evaluate('while(true){}', ctx()))
      .toThrow(EvaluationTimeoutError)
  })

  it('throws EvaluationTimeoutError for deeply recursive computation', () => {
    const shortTimeout = new JsEvaluator({ timeoutMs: 50 })
    // Blocked by pattern check before timeout, so use a non-blocked variant
    // that just runs forever via iteration
    expect(() => shortTimeout.evaluate('let i = 0; while(i >= 0) { i++ }', ctx()))
      .toThrow(EvaluationTimeoutError)
  })
})

// ─── Error handling ───────────────────────────────────────────────────────────

describe('JsEvaluator — error handling', () => {
  it('throws ExpressionSyntaxError for invalid JS syntax', () => {
    expect(() => evaluator.evaluate('x ===', ctx()))
      .toThrow(ExpressionSyntaxError)
  })

  it('includes the expression in the ExpressionSyntaxError', () => {
    expect(() => evaluator.evaluate('x ===', ctx())).toThrow(
      expect.objectContaining({ expression: 'x ===' }),
    )
  })

  it('returns undefined for a reference to an undeclared variable (tolerant mode)', () => {
    // Variables not in the context are undefined — no throw, just undefined
    expect(evaluator.evaluate('undeclaredVar', ctx())).toBeUndefined()
  })
})
