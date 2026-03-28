import type {
  StateStore,
  EngineState,
  StoreOperation,
  VariableScope,
  VariableValue,
  ExecutionEvent,
  UserTaskRecord,
  ProcessDefinition,
  EventSubscription,
} from 'nexus-workflow-core'

// ─── Variable normalisation ───────────────────────────────────────────────────

/**
 * Converts a plain JSON object received from HTTP into the VariableValue format
 * the engine expects.  Raw primitives (string, number, boolean, null, array,
 * object) are wrapped as { type, value }.  Objects that already carry a `type`
 * and `value` key are passed through unchanged.
 */
export function normalizeVariables(raw: Record<string, unknown>): Record<string, VariableValue> {
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => {
      if (v !== null && typeof v === 'object' && 'type' in v && 'value' in v) {
        return [k, v as VariableValue]
      }
      const type =
        v === null ? 'null' :
        Array.isArray(v) ? 'array' :
        (typeof v as 'string' | 'number' | 'boolean' | 'object')
      return [k, { type, value: v } satisfies VariableValue]
    }),
  )
}

/**
 * Unwraps VariableValue objects back to plain JSON-serialisable primitives for
 * HTTP responses.  Keeps the API contract as raw values on both input and output.
 */
export function unwrapVariables(vars: Record<string, VariableValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.value]))
}

// ─── Engine State ─────────────────────────────────────────────────────────────

export async function loadEngineState(store: StateStore, instanceId: string): Promise<EngineState | null> {
  const instance = await store.getInstance(instanceId)
  if (!instance) return null
  const tokens = await store.getAllTokens(instanceId)
  const gatewayJoinStates = await store.listGatewayStates(instanceId)
  const scopeIds = new Set<string>([instance.rootScopeId, ...tokens.map(t => t.scopeId)])
  const scopes: VariableScope[] = []
  for (const id of scopeIds) {
    const scope = await store.getScope(id)
    if (scope) scopes.push(scope)
  }
  const compensationRecords = await store.listCompensationRecords(instanceId)
  return { instance, tokens, scopes, gatewayJoinStates, compensationRecords }
}

// ─── Store Operations ─────────────────────────────────────────────────────────

/**
 * Computes the full set of store operations needed to persist an engine result.
 *
 * Includes instance/token/scope/gateway diffs and subscription management.
 * Subscription IDs use the deterministic scheme `sub-${tokenId}` so they can
 * be created and deleted without a database lookup.
 */
export function computeStoreOps(
  isNew: boolean,
  oldState: EngineState | null,
  newState: EngineState,
): StoreOperation[] {
  const ops: StoreOperation[] = []
  const now = new Date()

  // Instance
  ops.push(isNew
    ? { op: 'createInstance', instance: newState.instance }
    : { op: 'updateInstance', instance: newState.instance }
  )

  // Tokens + scopes
  ops.push({ op: 'saveTokens', tokens: newState.tokens })
  for (const scope of newState.scopes) {
    ops.push({ op: 'saveScope', scope })
  }

  // Gateway join state diffs
  const newGwKeys = new Set(newState.gatewayJoinStates.map(gs => `${gs.gatewayId}::${gs.instanceId}`))
  for (const gs of newState.gatewayJoinStates) {
    ops.push({ op: 'saveGatewayState', state: gs })
  }
  for (const gs of (oldState?.gatewayJoinStates ?? [])) {
    if (!newGwKeys.has(`${gs.gatewayId}::${gs.instanceId}`)) {
      ops.push({ op: 'deleteGatewayState', gatewayId: gs.gatewayId, instanceId: gs.instanceId })
    }
  }

  // Subscription diffs (message/signal waiting tokens)
  // The engine is pure and does not manage subscriptions; the app layer maintains
  // the EventSubscription index so that POST /messages and POST /signals can do
  // an O(1) store lookup rather than scanning all active tokens.
  const oldTokenMap = new Map((oldState?.tokens ?? []).map(t => [t.id, t]))
  const newTokenMap = new Map(newState.tokens.map(t => [t.id, t]))

  for (const token of newState.tokens) {
    if (token.status !== 'waiting') continue
    const waitType = token.waitingFor?.type
    if (waitType !== 'message' && waitType !== 'signal') continue

    const oldToken = oldTokenMap.get(token.id)
    if (oldToken?.status === 'waiting') continue // subscription already exists

    const waitingFor = token.waitingFor
    if (!waitingFor) continue
    const data = waitingFor.correlationData ?? {}
    const sub: EventSubscription = {
      id: `sub-${token.id}`,
      instanceId: token.instanceId,
      tokenId: token.id,
      type: waitType,
      ...(waitType === 'message' && data['messageName'] ? { messageName: data['messageName'] as string } : {}),
      ...(waitType === 'signal' && data['signalName'] ? { signalName: data['signalName'] as string } : {}),
      status: 'active',
      createdAt: now,
    }
    ops.push({ op: 'saveSubscription', subscription: sub })
  }

  for (const oldToken of (oldState?.tokens ?? [])) {
    if (oldToken.status !== 'waiting') continue
    const waitType = oldToken.waitingFor?.type
    if (waitType !== 'message' && waitType !== 'signal') continue

    const newToken = newTokenMap.get(oldToken.id)
    if (!newToken || newToken.status !== 'waiting') {
      ops.push({ op: 'deleteSubscription', id: `sub-${oldToken.id}` })
    }
  }

  return ops
}

// ─── User Task Creation ───────────────────────────────────────────────────────

/** Resolve a BPMN expression like `${varName}` against root-scope variables. */
function resolveExpr(expr: string, state: EngineState): string {
  return expr.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    const rootScope = state.scopes.find(s => s.id === state.instance.rootScopeId)
    const val = rootScope?.variables[name]
    if (val === undefined) return expr
    // Variables may be stored as VariableValue objects { type, value } or as raw primitives
    const raw = (val !== null && typeof val === 'object' && 'value' in val)
      ? (val as { value: unknown }).value
      : val
    return String(raw)
  })
}

export function buildUserTaskCreationOps(
  events: ExecutionEvent[],
  definition: ProcessDefinition,
  state: EngineState,
): StoreOperation[] {
  const ops: StoreOperation[] = []

  for (const event of events) {
    if (event.type !== 'TokenWaiting') continue
    if (event.waitingFor.type !== 'user-task') continue

    const element = definition.elements.find(e => e.id === event.elementId)
    if (!element || element.type !== 'userTask') continue

    const resolvedAssignee = element.assignee !== undefined
      ? resolveExpr(element.assignee, state)
      : undefined

    const task: UserTaskRecord = {
      id: crypto.randomUUID(),
      instanceId: event.instanceId,
      tokenId: event.tokenId,
      elementId: event.elementId,
      name: element.name ?? event.elementId,
      ...(resolvedAssignee !== undefined ? { assignee: resolvedAssignee } : {}),
      ...(element.candidateGroups !== undefined ? { candidateGroups: element.candidateGroups } : {}),
      ...(element.dueDate !== undefined ? { dueDate: new Date(element.dueDate) } : {}),
      ...(element.formKey !== undefined ? { formKey: element.formKey } : {}),
      priority: element.priority ?? 50,
      inputVariables: {},
      status: 'open',
      createdAt: new Date(),
    }

    ops.push({ op: 'createUserTask', task })
  }

  return ops
}
