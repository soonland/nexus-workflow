import { describe, it, expect } from 'vitest'
import {
  WorkflowError,
  DefinitionError,
  RuntimeError,
  SandboxViolationError,
  EvaluationTimeoutError,
  ExpressionSyntaxError,
  ExpressionReferenceError,
  MessageNotDeliveredError,
  AmbiguousCorrelationError,
} from './errors.js'

// ─── WorkflowError (base) ─────────────────────────────────────────────────────

describe('WorkflowError', () => {
  it('sets name to the constructor name', () => {
    const err = new WorkflowError('msg', 'CODE')
    expect(err.name).toBe('WorkflowError')
  })

  it('exposes the code property', () => {
    const err = new WorkflowError('msg', 'MY_CODE')
    expect(err.code).toBe('MY_CODE')
  })

  it('is an instance of Error', () => {
    expect(new WorkflowError('msg', 'C')).toBeInstanceOf(Error)
  })
})

// ─── DefinitionError ──────────────────────────────────────────────────────────

describe('DefinitionError', () => {
  it('has code DEFINITION_ERROR', () => {
    expect(new DefinitionError('msg').code).toBe('DEFINITION_ERROR')
  })

  it('stores an optional definitionId', () => {
    const err = new DefinitionError('bad process', 'def-1')
    expect(err.definitionId).toBe('def-1')
  })

  it('definitionId is undefined when not provided', () => {
    const err = new DefinitionError('bad')
    expect(err.definitionId).toBeUndefined()
  })

  it('name is DefinitionError', () => {
    expect(new DefinitionError('msg').name).toBe('DefinitionError')
  })
})

// ─── RuntimeError ─────────────────────────────────────────────────────────────

describe('RuntimeError', () => {
  it('has code RUNTIME_ERROR', () => {
    expect(new RuntimeError('msg').code).toBe('RUNTIME_ERROR')
  })

  it('stores an optional instanceId', () => {
    const err = new RuntimeError('bad', 'inst-1')
    expect(err.instanceId).toBe('inst-1')
  })

  it('instanceId is undefined when not provided', () => {
    expect(new RuntimeError('msg').instanceId).toBeUndefined()
  })
})

// ─── SandboxViolationError ────────────────────────────────────────────────────

describe('SandboxViolationError', () => {
  it('has code SANDBOX_VIOLATION', () => {
    expect(new SandboxViolationError('msg', 'expr').code).toBe('SANDBOX_VIOLATION')
  })

  it('stores the offending expression', () => {
    const err = new SandboxViolationError('blocked', 'process.env')
    expect(err.expression).toBe('process.env')
  })
})

// ─── EvaluationTimeoutError ───────────────────────────────────────────────────

describe('EvaluationTimeoutError', () => {
  it('has code EVALUATION_TIMEOUT', () => {
    expect(new EvaluationTimeoutError('while(true){}').code).toBe('EVALUATION_TIMEOUT')
  })

  it('includes the expression in the message', () => {
    const err = new EvaluationTimeoutError('while(true){}')
    expect(err.message).toContain('while(true){}')
  })
})

// ─── ExpressionSyntaxError ────────────────────────────────────────────────────

describe('ExpressionSyntaxError', () => {
  it('has code EXPRESSION_SYNTAX_ERROR', () => {
    expect(new ExpressionSyntaxError('msg', 'x ===').code).toBe('EXPRESSION_SYNTAX_ERROR')
  })

  it('stores the offending expression', () => {
    const err = new ExpressionSyntaxError('Unexpected end', 'x ===')
    expect(err.expression).toBe('x ===')
  })
})

// ─── ExpressionReferenceError ─────────────────────────────────────────────────

describe('ExpressionReferenceError', () => {
  it('has code EXPRESSION_REFERENCE_ERROR', () => {
    expect(new ExpressionReferenceError('myVar', 'myVar > 0').code).toBe('EXPRESSION_REFERENCE_ERROR')
  })

  it('includes the variable name in the message', () => {
    const err = new ExpressionReferenceError('myVar', 'myVar > 0')
    expect(err.message).toContain('myVar')
  })

  it('stores the expression', () => {
    const err = new ExpressionReferenceError('myVar', 'myVar > 0')
    expect(err.expression).toBe('myVar > 0')
  })
})

// ─── MessageNotDeliveredError ─────────────────────────────────────────────────

describe('MessageNotDeliveredError', () => {
  it('has code MESSAGE_NOT_DELIVERED', () => {
    expect(new MessageNotDeliveredError('order.shipped').code).toBe('MESSAGE_NOT_DELIVERED')
  })

  it('includes the message name in the message text', () => {
    const err = new MessageNotDeliveredError('order.shipped')
    expect(err.message).toContain('order.shipped')
  })

  it('includes the correlationKey when provided', () => {
    const err = new MessageNotDeliveredError('order.shipped', 'order-123')
    expect(err.message).toContain('order-123')
  })

  it('omits correlationKey detail when not provided', () => {
    const err = new MessageNotDeliveredError('order.shipped')
    expect(err.message).not.toContain('correlationKey')
  })
})

// ─── AmbiguousCorrelationError ────────────────────────────────────────────────

describe('AmbiguousCorrelationError', () => {
  it('has code AMBIGUOUS_CORRELATION', () => {
    expect(new AmbiguousCorrelationError('order.shipped', 'order-123', 3).code).toBe('AMBIGUOUS_CORRELATION')
  })

  it('includes the message name, correlationKey, and count in the message', () => {
    const err = new AmbiguousCorrelationError('order.shipped', 'order-123', 3)
    expect(err.message).toContain('order.shipped')
    expect(err.message).toContain('order-123')
    expect(err.message).toContain('3')
  })
})
