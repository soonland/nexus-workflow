import type {
  StateStore,
  EngineState,
  StoreOperation,
  VariableScope,
  ExecutionEvent,
  UserTaskRecord,
  ProcessDefinition,
} from 'nexus-workflow-core'

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
  return { instance, tokens, scopes, gatewayJoinStates }
}

// ─── Store Operations ─────────────────────────────────────────────────────────

export function computeStoreOps(
  isNew: boolean,
  oldState: EngineState | null,
  newState: EngineState,
): StoreOperation[] {
  const ops: StoreOperation[] = []

  ops.push(isNew
    ? { op: 'createInstance', instance: newState.instance }
    : { op: 'updateInstance', instance: newState.instance }
  )
  ops.push({ op: 'saveTokens', tokens: newState.tokens })
  for (const scope of newState.scopes) {
    ops.push({ op: 'saveScope', scope })
  }

  const newGwKeys = new Set(
    newState.gatewayJoinStates.map(gs => `${gs.gatewayId}::${gs.instanceId}`)
  )
  for (const gs of newState.gatewayJoinStates) {
    ops.push({ op: 'saveGatewayState', state: gs })
  }
  for (const gs of (oldState?.gatewayJoinStates ?? [])) {
    if (!newGwKeys.has(`${gs.gatewayId}::${gs.instanceId}`)) {
      ops.push({ op: 'deleteGatewayState', gatewayId: gs.gatewayId, instanceId: gs.instanceId })
    }
  }

  return ops
}

// ─── User Task Creation ───────────────────────────────────────────────────────

export function buildUserTaskCreationOps(
  events: ExecutionEvent[],
  definition: ProcessDefinition,
): StoreOperation[] {
  const ops: StoreOperation[] = []

  for (const event of events) {
    if (event.type !== 'TokenWaiting') continue
    if (event.waitingFor.type !== 'user-task') continue

    const element = definition.elements.find(e => e.id === event.elementId)
    if (!element || element.type !== 'userTask') continue

    const task: UserTaskRecord = {
      id: crypto.randomUUID(),
      instanceId: event.instanceId,
      tokenId: event.tokenId,
      elementId: event.elementId,
      name: element.name ?? event.elementId,
      assignee: element.assignee,
      candidateGroups: element.candidateGroups,
      dueDate: element.dueDate ? new Date(element.dueDate) : undefined,
      priority: element.priority ?? 50,
      inputVariables: {},
      formKey: element.formKey,
      status: 'open',
      createdAt: new Date(),
    }

    ops.push({ op: 'createUserTask', task })
  }

  return ops
}
