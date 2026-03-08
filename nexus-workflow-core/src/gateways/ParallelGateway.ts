import { RuntimeError } from '../model/errors.js'
import type { SequenceFlow, ParallelGatewayJoinState } from '../model/types.js'

// ─── Split ────────────────────────────────────────────────────────────────────

/**
 * Evaluates an AND (parallel) gateway split.
 * Returns the IDs of every outgoing flow — all branches activate simultaneously.
 */
export function evaluateParallelSplit(
  gatewayId: string,
  outgoingFlows: SequenceFlow[],
): string[] {
  if (outgoingFlows.length === 0) {
    throw new RuntimeError(
      `Parallel gateway "${gatewayId}" has no outgoing sequence flows`,
    )
  }

  return outgoingFlows.map(f => f.id)
}

// ─── Join ─────────────────────────────────────────────────────────────────────

export interface ParallelJoinResult {
  /** True when all expected branches have now arrived and the gateway fires. */
  fires: boolean
  /** Updated join state reflecting the newly arrived flow. Caller must persist this. */
  updatedState: ParallelGatewayJoinState
}

/**
 * Evaluates an AND (parallel) gateway join when a token arrives via `arrivingFlowId`.
 *
 * Tracking is done by flow ID (not count) so that a looping branch delivering
 * the same flow twice does not falsely satisfy a different branch's slot.
 *
 * The caller is responsible for:
 * - Persisting `updatedState` when `fires` is false (more branches in-flight).
 * - Deleting the join state and producing one outgoing token when `fires` is true.
 */
export function evaluateParallelJoin(
  gatewayId: string,
  arrivingFlowId: string,
  currentState: ParallelGatewayJoinState,
): ParallelJoinResult {
  // Use a Set to deduplicate — a flow arriving twice counts only once.
  const arrived = new Set(currentState.arrivedFromFlows)
  arrived.add(arrivingFlowId)

  const updatedState: ParallelGatewayJoinState = {
    ...currentState,
    arrivedFromFlows: [...arrived],
  }

  const expected = new Set(currentState.expectedFlows)
  const fires = currentState.expectedFlows.every(flowId => arrived.has(flowId))
    && arrived.size >= expected.size

  return { fires, updatedState }
}
