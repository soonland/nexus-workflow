import { execute, RuntimeError, type StateStore, type EventBus, type Scheduler, type EngineState, type VariableScope, type GatewayJoinState, type StoreOperation, type ScheduledTimer, type IntermediateCatchEventElement, type BoundaryEventElement } from 'nexus-workflow-core'
import { parseTimerExpression } from './parseTimerExpression.js'

/**
 * Wires three things together:
 *
 * 1. `TokenWaiting` (timer type) → parse timer expression → `scheduler.schedule()`
 * 2. `TokenCancelled`            → `scheduler.cancel(tokenId)` (no-op if not a timer)
 * 3. `scheduler.onTimerFired`    → `execute(FireTimer)` → persist → emit events
 */
export class TimerCoordinator {
  private readonly store: StateStore
  private readonly eventBus: EventBus
  private readonly scheduler: Scheduler
  private readonly unsubscribers: Array<() => void> = []

  constructor(store: StateStore, eventBus: EventBus, scheduler: Scheduler) {
    this.store = store
    this.eventBus = eventBus
    this.scheduler = scheduler
  }

  start(): void {
    this.unsubscribers.push(
      this.eventBus.subscribeToType('TokenWaiting', (event) => {
        if (event.waitingFor.type !== 'timer') return
        return this.onTokenWaiting(event.instanceId, event.tokenId, event.elementId)
      }),
    )

    this.unsubscribers.push(
      this.eventBus.subscribeToType('TokenCancelled', (event) => {
        // Cancel any scheduled timer for this token (no-op if none exists)
        return this.scheduler.cancel(event.tokenId)
      }),
    )

    this.scheduler.onTimerFired((timer) => this.onTimerFired(timer))
  }

  stop(): void {
    for (const unsub of this.unsubscribers) unsub()
    this.unsubscribers.length = 0
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async onTokenWaiting(instanceId: string, tokenId: string, elementId: string): Promise<void> {
    const instance = await this.store.getInstance(instanceId)
    if (!instance) return

    const definition = await this.store.getDefinition(instance.definitionId, instance.definitionVersion)
    if (!definition) return

    const element = definition.elements.find(e => e.id === elementId)
    if (!element) return

    let timerExpression: string | undefined
    if (element.type === 'intermediateCatchEvent') {
      timerExpression = (element as IntermediateCatchEventElement).eventDefinition.timerExpression
    } else if (element.type === 'boundaryEvent') {
      timerExpression = (element as BoundaryEventElement).eventDefinition.timerExpression
    }

    if (!timerExpression) return

    let fireAt: Date
    try {
      fireAt = parseTimerExpression(timerExpression, new Date())
    } catch {
      console.error(`[TimerCoordinator] Failed to parse timer expression "${timerExpression}" for token ${tokenId}`)
      return
    }

    const timer: ScheduledTimer = {
      id: tokenId,
      instanceId,
      tokenId,
      fireAt,
      createdAt: new Date(),
    }

    await this.scheduler.schedule(timer)
  }

  private async onTimerFired(timer: ScheduledTimer): Promise<void> {
    const state = await this.loadEngineState(timer.instanceId)
    if (!state) return

    // Idempotency: if the token is no longer waiting, skip
    const token = state.tokens.find(t => t.id === timer.tokenId && t.status === 'waiting')
    if (!token) return

    const definition = await this.store.getDefinition(
      state.instance.definitionId,
      state.instance.definitionVersion,
    )
    if (!definition) return

    let result
    try {
      result = execute(definition, { type: 'FireTimer', tokenId: timer.tokenId }, state)
    } catch (e) {
      if (e instanceof RuntimeError) return  // token no longer actionable
      throw e
    }

    await this.store.executeTransaction(buildStoreOps(state, result.newState))
    await this.eventBus.publish({
      type: 'TimerFired',
      instanceId: timer.instanceId,
      tokenId: timer.tokenId,
      timerId: timer.id,
    })
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
