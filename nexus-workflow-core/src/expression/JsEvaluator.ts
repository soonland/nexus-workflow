import { runInNewContext } from 'node:vm'
import {
  SandboxViolationError,
  EvaluationTimeoutError,
  ExpressionSyntaxError,
} from '../model/errors.js'
import type { ExpressionEvaluator, ExpressionContext } from '../interfaces/ExpressionEvaluator.js'
import type { VariableValue } from '../model/types.js'

// ─── Blocked patterns ─────────────────────────────────────────────────────────
//
// These are checked against the raw expression string before evaluation.
// Any match throws SandboxViolationError immediately, preventing the expression
// from reaching the vm at all.

const BLOCKED_PATTERNS: ReadonlyArray<RegExp> = [
  /\bprocess\b/,
  /\brequire\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\b__proto__\b/,
  /\bconstructor\b/,
  /\bprototype\b/,
  /\beval\b/,
  /\bFunction\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bsetImmediate\b/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bImportScripts\b/,
]

// ─── JsEvaluator ─────────────────────────────────────────────────────────────

export interface JsEvaluatorOptions {
  /** Max execution time in milliseconds before EvaluationTimeoutError is thrown. Default: 100. */
  timeoutMs?: number
}

/**
 * Evaluates JavaScript expressions in a restricted vm context.
 *
 * Protection layers:
 * 1. Pattern blocklist — rejects expressions mentioning dangerous identifiers
 *    before they reach the vm (fast path, catches most attacks).
 * 2. Clean vm context — the sandbox contains only the resolved variable values;
 *    Node.js globals (process, require, Buffer, etc.) are absent.
 * 3. Execution timeout — terminates expressions that loop indefinitely.
 *
 * Note: The Node.js `vm` module is not a full security boundary. It should not
 * be used to evaluate fully untrusted input. For that, use isolated-vm or a
 * subprocess. This evaluator is designed for BPMN condition expressions written
 * by process designers — trusted authors, not arbitrary end-users.
 */
export class JsEvaluator implements ExpressionEvaluator {
  readonly language = 'javascript'

  private readonly timeoutMs: number

  constructor(options: JsEvaluatorOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 100
  }

  evaluate(expression: string, context: ExpressionContext): unknown {
    this.checkBlocklist(expression)

    const sandbox = this.buildSandbox(context.variables)

    try {
      return runInNewContext(expression, sandbox, { timeout: this.timeoutMs })
    } catch (err) {
      // Avoid instanceof checks — errors crossing vm/worker/ESM realm boundaries
      // may fail instanceof even for built-in types. Use duck-typing instead.
      const anyErr = err as Record<string, unknown>
      const code = anyErr['code']
      const name = String(anyErr['name'] ?? '')
      const message = String(anyErr['message'] ?? '')

      if (code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || message.toLowerCase().includes('timed out')) {
        throw new EvaluationTimeoutError(expression)
      }
      if (name === 'SyntaxError') {
        throw new ExpressionSyntaxError(message, expression)
      }
      // Re-throw any other runtime error (e.g. TypeError)
      throw err
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private checkBlocklist(expression: string): void {
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(expression)) {
        throw new SandboxViolationError(
          `Expression contains a blocked identifier (matched ${pattern}). Potentially unsafe access denied.`,
          expression,
        )
      }
    }
  }

  private buildSandbox(variables: Record<string, VariableValue>): object {
    const flat: Record<string, unknown> = Object.fromEntries(
      Object.entries(variables).map(([key, v]) => [key, v.value]),
    )
    // Use a Proxy with `has: () => true` so the vm treats every identifier as
    // "declared" — accessing an unknown variable returns undefined instead of
    // throwing ReferenceError. This gives tolerant/optional-chaining semantics.
    return new Proxy(flat, {
      has: () => true,
      get: (target, key) => (key in target ? target[key as string] : undefined),
    })
  }
}

