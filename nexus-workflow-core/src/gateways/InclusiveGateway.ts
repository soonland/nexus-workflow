import { DefinitionError, RuntimeError } from '../model/errors.js'
import type { SequenceFlow, InclusiveGatewayJoinState } from '../model/types.js'

// ─── Split ────────────────────────────────────────────────────────────────────

export interface InclusiveSplitResult {
  /** IDs of the flows that were activated and should receive tokens. */
  activatedFlowIds: string[]
}

/**
 * Evaluates an OR (inclusive) gateway split.
 *
 * Rules:
 * - Every non-default flow whose condition evaluates to true is activated.
 * - All flows are evaluated (unlike XOR which stops at first match).
 * - The default flow is activated only when no other flow matched.
 * - If no flow matches and there is no default, a DefinitionError is thrown.
 *
 * The returned `activatedFlowIds` must be stored in `InclusiveGatewayJoinState`
 * so the corresponding join knows which paths to wait for.
 */
export function evaluateInclusiveSplit(
  gatewayId: string,
  outgoingFlows: SequenceFlow[],
  defaultFlowId: string | undefined,
  evaluate: (expression: string) => boolean,
): InclusiveSplitResult {
  if (outgoingFlows.length === 0) {
    throw new RuntimeError(
      `Inclusive gateway "${gatewayId}" has no outgoing sequence flows`,
    )
  }

  const activated: string[] = []
  let defaultFlow: SequenceFlow | undefined

  for (const flow of outgoingFlows) {
    if (flow.id === defaultFlowId || flow.isDefault) {
      defaultFlow = flow
      continue
    }

    // A flow with no condition expression is unconditionally true.
    const matches = flow.conditionExpression === undefined
      ? true
      : evaluate(flow.conditionExpression)

    if (matches) {
      activated.push(flow.id)
    }
  }

  if (activated.length === 0) {
    if (defaultFlow !== undefined) {
      return { activatedFlowIds: [defaultFlow.id] }
    }
    throw new DefinitionError(
      `Inclusive gateway "${gatewayId}": no condition matched and no default flow is defined`,
    )
  }

  return { activatedFlowIds: activated }
}

// ─── Join ─────────────────────────────────────────────────────────────────────

export interface InclusiveJoinResult {
  /** True when all activated paths have now arrived and the gateway fires. */
  fires: boolean
  /** Updated join state reflecting the newly arrived flow. Caller must persist this. */
  updatedState: InclusiveGatewayJoinState
}

/**
 * Evaluates an OR (inclusive) gateway join when a token arrives via `arrivingFlowId`.
 *
 * The join fires when every flow in `activatedIncomingFlows` (recorded at split
 * time) has arrived. Flows that were not activated at split time are ignored —
 * they cannot satisfy or block the join.
 */
export function evaluateInclusiveJoin(
  _gatewayId: string,
  arrivingFlowId: string,
  currentState: InclusiveGatewayJoinState,
): InclusiveJoinResult {
  const arrived = new Set(currentState.arrivedFromFlows)
  arrived.add(arrivingFlowId)

  const updatedState: InclusiveGatewayJoinState = {
    ...currentState,
    arrivedFromFlows: [...arrived],
  }

  // The join fires when every activated path has delivered a token.
  const fires = currentState.activatedIncomingFlows.every(flowId => arrived.has(flowId))

  return { fires, updatedState }
}
