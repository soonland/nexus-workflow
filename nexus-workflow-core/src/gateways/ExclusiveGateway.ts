import { DefinitionError, RuntimeError } from '../model/errors.js'
import type { SequenceFlow } from '../model/types.js'

/**
 * Evaluates an XOR (exclusive) gateway split and returns the ID of the
 * single outgoing sequence flow that should receive the token.
 *
 * Rules (per BPMN 2.0 spec):
 * - Flows are evaluated in declaration order.
 * - The first flow whose condition evaluates to true is selected.
 * - Flows with no condition expression are treated as always-true.
 * - The default flow (isDefault: true) is never condition-evaluated; it is
 *   selected only when no other flow matched.
 * - If no flow matches and there is no default, a DefinitionError is thrown.
 *
 * @param gatewayId  - Element ID of the gateway (for error messages).
 * @param outgoingFlows - All outgoing sequence flows from this gateway.
 * @param defaultFlowId - The ID of the designated default flow, if any.
 * @param evaluate   - Evaluates a condition expression; returns true/false.
 */
export function evaluateExclusiveSplit(
  gatewayId: string,
  outgoingFlows: SequenceFlow[],
  defaultFlowId: string | undefined,
  evaluate: (expression: string) => boolean,
): string {
  if (outgoingFlows.length === 0) {
    throw new RuntimeError(
      `Exclusive gateway "${gatewayId}" has no outgoing sequence flows`,
    )
  }

  let defaultFlow: SequenceFlow | undefined

  for (const flow of outgoingFlows) {
    // Skip the default flow during the main pass — it is the last resort.
    if (flow.id === defaultFlowId || flow.isDefault) {
      defaultFlow = flow
      continue
    }

    // A flow with no condition expression is unconditionally true.
    if (flow.conditionExpression === undefined) {
      return flow.id
    }

    if (evaluate(flow.conditionExpression)) {
      return flow.id
    }
  }

  // No conditional flow matched — fall back to the default flow.
  if (defaultFlow !== undefined) {
    return defaultFlow.id
  }

  throw new DefinitionError(
    `Exclusive gateway "${gatewayId}": no condition matched and no default flow is defined`,
  )
}
