import { deriveHistory, type EngineState, type ExecutionEvent, type StoreOperation } from 'nexus-workflow-core'

/**
 * The store operations that write down the steps an execution cycle finished (see `deriveHistory`).
 * Every place that persists an engine result adds these to the same transaction as the state change.
 */
export function historyOps(oldState: EngineState | null, newState: EngineState, events: ExecutionEvent[]): StoreOperation[] {
  return deriveHistory(oldState, newState, events).map((entry) => ({ op: 'appendHistory' as const, entry }))
}
