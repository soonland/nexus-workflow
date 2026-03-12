import { execute, RuntimeError ,type 
  StateStore,type 
  EventBus,type 
  ServiceTaskHandler,type 
  TaskContext,type 
  EngineState,type 
  VariableScope,type 
  VariableValue,type 
  GatewayJoinState,type 
  StoreOperation,
} from 'nexus-workflow-core'

// ─── Options ──────────────────────────────────────────────────────────────────

export interface TaskWorkerOptions {
  /** Maximum number of attempts before failing the task. Default: 3. */
  maxAttempts?: number
  /** Base delay in ms for exponential backoff between retries. Default: 1000. */
  baseRetryDelayMs?: number
}

// ─── TaskWorker ───────────────────────────────────────────────────────────────

export class TaskWorker {
  private readonly store: StateStore
  private readonly eventBus: EventBus
  private readonly maxAttempts: number
  private readonly baseRetryDelayMs: number
  private readonly handlers = new Map<string, ServiceTaskHandler>()

  /** Tracks the current attempt number for each token. Cleaned up on terminal outcome. */
  private readonly attemptByToken = new Map<string, number>()

  /**
   * Idempotency guard: prevents concurrent or duplicate processing of the same
   * (tokenId, attempt) pair. An entry is added before processing begins and
   * never removed, so a duplicate event arriving after completion is ignored
   * (the token won't be waiting any more anyway, but this is a fast path).
   */
  private readonly inflightKeys = new Set<string>()

  private unsubscribe: (() => void) | null = null

  constructor(store: StateStore, eventBus: EventBus, options: TaskWorkerOptions = {}) {
    this.store = store
    this.eventBus = eventBus
    this.maxAttempts = options.maxAttempts ?? 3
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 1000
  }

  /** Register a service task handler. Overwrites any existing handler for the same taskType. */
  register(handler: ServiceTaskHandler): void {
    this.handlers.set(handler.taskType, handler)
  }

  /** Subscribe to ServiceTaskStarted events and begin dispatching. Idempotent. */
  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.eventBus.subscribeToType('ServiceTaskStarted', (event) => {
      void this.dispatch(event.instanceId, event.tokenId, event.elementId, event.taskType)
    })
  }

  /** Unsubscribe from events. In-flight tasks continue until they settle. */
  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  // ─── Private: dispatch & run ───────────────────────────────────────────────

  private async dispatch(
    instanceId: string,
    tokenId: string,
    elementId: string,
    taskType: string,
  ): Promise<void> {
    const attempt = this.attemptByToken.get(tokenId) ?? 1
    const key = `${tokenId}:${attempt}`
    if (this.inflightKeys.has(key)) return
    this.inflightKeys.add(key)
    this.attemptByToken.set(tokenId, attempt)
    await this.runAttempt(instanceId, tokenId, elementId, taskType, attempt)
  }

  private async runAttempt(
    instanceId: string,
    tokenId: string,
    elementId: string,
    taskType: string,
    attempt: number,
  ): Promise<void> {
    // Load current engine state
    const state = await this.loadEngineState(instanceId)
    if (!state) return

    // Idempotency: if the token is no longer waiting, it's already been processed
    const token = state.tokens.find(t => t.id === tokenId && t.status === 'waiting')
    if (!token) return

    const handler = this.handlers.get(taskType)
    if (!handler) {
      await this.fail(instanceId, tokenId, state, {
        code: 'HANDLER_NOT_FOUND',
        message: `No handler registered for task type '${taskType}'`,
      })
      this.attemptByToken.delete(tokenId)
      return
    }

    // Resolve variables from the scope chain (innermost scope wins)
    const scopeChain = await this.store.getScopeChain(token.scopeId)
    const variables = mergeScopes(scopeChain)

    const context: TaskContext = { instanceId, tokenId, elementId, taskType, attempt, variables }

    let result
    try {
      result = await handler.execute(context)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.fail(instanceId, tokenId, state, { code: 'HANDLER_EXCEPTION', message })
      this.attemptByToken.delete(tokenId)
      return
    }

    if (result.status === 'completed') {
      await this.complete(instanceId, tokenId, state, result.outputVariables)
      this.attemptByToken.delete(tokenId)
    } else if (result.status === 'error') {
      const error = result.error ?? { code: 'HANDLER_ERROR', message: 'Handler returned error status' }
      await this.fail(instanceId, tokenId, state, error)
      this.attemptByToken.delete(tokenId)
    } else {
      // 'retry'
      const nextAttempt = attempt + 1
      if (nextAttempt > this.maxAttempts) {
        const error = result.error ?? { code: 'MAX_RETRIES', message: `Max attempts (${this.maxAttempts}) reached` }
        await this.fail(instanceId, tokenId, state, error)
        this.attemptByToken.delete(tokenId)
        return
      }

      this.attemptByToken.set(tokenId, nextAttempt)
      const delay = result.retryDelay ?? this.backoffDelay(attempt)

      setTimeout(() => {
        const key = `${tokenId}:${nextAttempt}`
        if (this.inflightKeys.has(key)) return
        this.inflightKeys.add(key)
        void this.runAttempt(instanceId, tokenId, elementId, taskType, nextAttempt)
      }, delay)
    }
  }

  private backoffDelay(attempt: number): number {
    return this.baseRetryDelayMs * Math.pow(2, attempt - 1)
  }

  // ─── Private: engine interactions ─────────────────────────────────────────

  private async complete(
    instanceId: string,
    tokenId: string,
    state: EngineState,
    outputVariables?: Record<string, VariableValue>,
  ): Promise<void> {
    const definition = await this.store.getDefinition(
      state.instance.definitionId,
      state.instance.definitionVersion,
    )
    if (!definition) return

    let result
    try {
      result = execute(
        definition,
        { type: 'CompleteServiceTask', tokenId, ...(outputVariables ? { outputVariables } : {}) },
        state,
      )
    } catch (e) {
      if (e instanceof RuntimeError) return  // token no longer actionable
      throw e
    }

    await this.store.executeTransaction(buildStoreOps(state, result.newState))
    await this.eventBus.publishMany(result.events)
  }

  private async fail(
    instanceId: string,
    tokenId: string,
    state: EngineState,
    error: { code: string; message: string },
  ): Promise<void> {
    const definition = await this.store.getDefinition(
      state.instance.definitionId,
      state.instance.definitionVersion,
    )
    if (!definition) return

    let result
    try {
      result = execute(definition, { type: 'FailServiceTask', tokenId, error }, state)
    } catch (e) {
      if (e instanceof RuntimeError) return
      throw e
    }

    await this.store.executeTransaction(buildStoreOps(state, result.newState))
    await this.eventBus.publishMany(result.events)
  }

  private async loadEngineState(instanceId: string): Promise<EngineState | null> {
    const instance = await this.store.getInstance(instanceId)
    if (!instance) return null
    const tokens = await this.store.getAllTokens(instanceId)
    const gatewayJoinStates = await this.store.listGatewayStates(instanceId)
    const scopeIds = new Set<string>([instance.rootScopeId, ...tokens.map(t => t.scopeId)])
    const scopes: VariableScope[] = []
    for (const id of scopeIds) {
      const scope = await this.store.getScope(id)
      if (scope) scopes.push(scope)
    }
    return { instance, tokens, scopes, gatewayJoinStates }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Merge scope chain into a flat variable map. Root scope is last; innermost wins. */
function mergeScopes(chain: VariableScope[]): Record<string, VariableValue> {
  // chain[0] is the leaf (innermost); chain[last] is the root
  const merged: Record<string, VariableValue> = {}
  for (let i = chain.length - 1; i >= 0; i--) {
    const scope = chain[i] as VariableScope
    Object.assign(merged, scope.variables)
  }
  return merged
}

function buildStoreOps(oldState: EngineState, newState: EngineState): StoreOperation[] {
  const ops: StoreOperation[] = []
  ops.push({ op: 'updateInstance', instance: newState.instance })
  ops.push({ op: 'saveTokens', tokens: newState.tokens })
  for (const scope of newState.scopes) {
    ops.push({ op: 'saveScope', scope })
  }
  const newGwKeys = new Set(
    newState.gatewayJoinStates.map((gs: GatewayJoinState) => `${gs.gatewayId}::${gs.instanceId}`)
  )
  for (const gs of newState.gatewayJoinStates) {
    ops.push({ op: 'saveGatewayState', state: gs })
  }
  for (const gs of oldState.gatewayJoinStates) {
    if (!newGwKeys.has(`${gs.gatewayId}::${gs.instanceId}`)) {
      ops.push({ op: 'deleteGatewayState', gatewayId: gs.gatewayId, instanceId: gs.instanceId })
    }
  }
  return ops
}
