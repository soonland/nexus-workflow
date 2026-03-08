import type { VariableValue } from '../model/types.js'

export interface ExpressionContext {
  variables: Record<string, VariableValue>
  /** Optional additional context (element id, instance id) for error reporting */
  meta?: Record<string, string>
}

export interface ExpressionEvaluator {
  readonly language: string

  /**
   * Evaluate an expression and return the result.
   * @throws {SandboxViolationError} if the expression attempts to escape the sandbox
   * @throws {EvaluationTimeoutError} if the expression exceeds the time limit
   * @throws {ExpressionSyntaxError} if the expression cannot be parsed
   * @throws {ExpressionReferenceError} if a required variable is undefined
   */
  evaluate(expression: string, context: ExpressionContext): unknown
}
