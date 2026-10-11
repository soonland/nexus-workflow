import type { HistoryEntry, VariableScope, VariableValue } from '../model/types.js'
import type { ExecutionEvent } from '../interfaces/EventBus.js'
import type { EngineState } from './ExecutionEngine.js'

/** A snapshot bigger than this is left out of the entry (the entry itself is still written). */
export const MAX_SNAPSHOT_BYTES = 64 * 1024

export interface DeriveHistoryOptions {
  /** Largest variables snapshot to keep, in bytes of JSON. Default 64 KiB. */
  maxSnapshotBytes?: number
}

/**
 * The history entries that one execution cycle produced: one for every element visit that finished.
 *
 * The engine gives every visit to an element its own token (when a token moves on it is completed and
 * a new one is created at the next element), so a visit is exactly a token: it starts when the token
 * is created and ends when it is completed or cancelled. History is therefore read straight off the
 * tokens that finished in this cycle, comparing the state before and after. Pure: the callers that
 * persist engine results (HTTP routes, the task worker, the timers) can all write the same history in
 * the same transaction.
 *
 *  - `completed`: the token moved on from the element, or finished there (an end event).
 *  - `cancelled`: the token was cancelled while at the element (the instance was cancelled, a
 *    boundary event interrupted it, a sibling branch ended it).
 *  - `error`: an error was thrown by the token (the events of the cycle say so), whatever became of it.
 *
 * A step a person forced (the cycle's events include a `StepForced` for its token) carries who, why and how.
 *
 * `startedAt` is when the token arrived at the element, `completedAt` when it left. An element the
 * instance passes through within one cycle therefore takes no time.
 *
 * The variables snapshot is the token's variables as they stand at the end of the cycle in which it
 * finished: elements finished in the same cycle share it.
 *
 * Every branch that arrives at a join is its own visit (its own token, finished when it arrives), so a
 * join with three branches has three entries, each at the time that branch got there.
 */
export function deriveHistory(
  oldState: EngineState | null,
  newState: EngineState,
  /** The events of the cycle; only used to tell `error` from a plain cancellation. */
  events: ExecutionEvent[] = [],
  options: DeriveHistoryOptions = {},
): HistoryEntry[] {
  const maxBytes = options.maxSnapshotBytes ?? MAX_SNAPSHOT_BYTES
  const instanceId = newState.instance.id

  const wasOver = new Set(
    (oldState?.tokens ?? []).filter((t) => t.status === 'completed' || t.status === 'cancelled').map((t) => t.id),
  )
  const threwError = new Set(events.flatMap((e) => (e.type === 'ErrorThrown' ? [e.tokenId] : [])))
  // Steps a person pushed along by hand: the app adds a StepForced event for each to the cycle's events
  const forcedBy = new Map<string, NonNullable<HistoryEntry['forced']>>()
  for (const e of events) {
    if (e.type === 'StepForced') {
      forcedBy.set(e.tokenId, { action: e.action, by: e.forcedBy, reason: e.reason, ...(e.onBehalfOf ? { onBehalfOf: e.onBehalfOf } : {}) })
    }
  }
  const scopes = new Map(newState.scopes.map((s) => [s.id, s]))

  /** The variables the token can see, innermost scope winning; undefined if there are none or too many. */
  const snapshotFor = (scopeId: string): Record<string, VariableValue> | undefined => {
    const chain: VariableScope[] = []
    for (let id: string | undefined = scopeId; id; id = scopes.get(id)?.parentScopeId) {
      const scope = scopes.get(id)
      if (!scope || chain.includes(scope)) break
      chain.push(scope)
    }
    const merged: Record<string, VariableValue> = {}
    for (const scope of chain.reverse()) Object.assign(merged, structuredClone(scope.variables))
    if (Object.keys(merged).length === 0) return undefined
    return JSON.stringify(merged).length > maxBytes ? undefined : merged
  }

  const entries: HistoryEntry[] = []

  for (const token of newState.tokens) {
    if (wasOver.has(token.id)) continue
    if (token.status !== 'completed' && token.status !== 'cancelled') continue

    const status: HistoryEntry['status'] = threwError.has(token.id) ? 'error' : token.status
    const snapshot = snapshotFor(token.scopeId)
    const forced = forcedBy.get(token.id)
    const entry: HistoryEntry = {
      id: token.id,
      instanceId,
      tokenId: token.id,
      elementId: token.elementId,
      elementType: token.elementType,
      status,
      startedAt: token.createdAt,
      completedAt: token.updatedAt,
      ...(snapshot ? { variablesSnapshot: snapshot } : {}),
      ...(forced ? { forced } : {}),
    }

    entries.push(entry)
  }

  // Oldest visit first, then in the order the engine holds them
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.completedAt.getTime() - b.entry.completedAt.getTime() || a.entry.startedAt.getTime() - b.entry.startedAt.getTime() || a.index - b.index)
    .map(({ entry }) => entry)
}
