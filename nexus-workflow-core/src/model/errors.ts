export class WorkflowError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message)
    this.name = this.constructor.name
  }
}

/** The process definition has a structural or semantic problem. */
export class DefinitionError extends WorkflowError {
  constructor(message: string, public readonly definitionId?: string) {
    super(message, 'DEFINITION_ERROR')
  }
}

/** A command was issued that violates engine runtime rules. */
export class RuntimeError extends WorkflowError {
  constructor(message: string, public readonly instanceId?: string) {
    super(message, 'RUNTIME_ERROR')
  }
}

/** An expression attempted to access forbidden APIs. */
export class SandboxViolationError extends WorkflowError {
  constructor(message: string, public readonly expression: string) {
    super(message, 'SANDBOX_VIOLATION')
  }
}

/** An expression exceeded its time limit. */
export class EvaluationTimeoutError extends WorkflowError {
  constructor(expression: string) {
    super(`Expression timed out: ${expression}`, 'EVALUATION_TIMEOUT')
  }
}

/** An expression has invalid syntax. */
export class ExpressionSyntaxError extends WorkflowError {
  constructor(message: string, public readonly expression: string) {
    super(message, 'EXPRESSION_SYNTAX_ERROR')
  }
}

/** An expression references an undefined variable. */
export class ExpressionReferenceError extends WorkflowError {
  constructor(variableName: string, public readonly expression: string) {
    super(`Undefined variable: "${variableName}"`, 'EXPRESSION_REFERENCE_ERROR')
  }
}

/** A delivered message could not be correlated to any waiting instance. */
export class MessageNotDeliveredError extends WorkflowError {
  constructor(messageName: string, correlationKey?: string) {
    const detail = correlationKey ? ` (correlationKey: ${correlationKey})` : ''
    super(`No subscriber found for message "${messageName}"${detail}`, 'MESSAGE_NOT_DELIVERED')
  }
}

/** A message matched more than one instance when only one was expected. */
export class AmbiguousCorrelationError extends WorkflowError {
  constructor(messageName: string, correlationKey: string, count: number) {
    super(
      `Message "${messageName}" with correlationKey "${correlationKey}" matched ${count} instances`,
      'AMBIGUOUS_CORRELATION',
    )
  }
}
