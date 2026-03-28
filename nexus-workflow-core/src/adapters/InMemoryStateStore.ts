import type {
  ProcessDefinition,
  ProcessInstance,
  Token,
  VariableScope,
  UserTaskRecord,
  EventSubscription,
  GatewayJoinState,
  HistoryEntry,
  ScheduledTimer,
  CompensationRecord,
} from '../model/types.js'
import type {
  StateStore,
  StoreOperation,
  InstanceQuery,
  UserTaskQuery,
  SubscriptionFilter,
  PagedResult,
  ProcessDefinitionSummary,
  ProcessInstanceSummary,
} from '../interfaces/StateStore.js'

function gatewayKey(gatewayId: string, instanceId: string): string {
  return `${instanceId}::${gatewayId}`
}


export class InMemoryStateStore implements StateStore {
  private definitions = new Map<string, ProcessDefinition>()
  private instances = new Map<string, ProcessInstance>()
  private tokens = new Map<string, Token[]>()
  private scopes = new Map<string, VariableScope>()
  private userTasks = new Map<string, UserTaskRecord>()
  private subscriptions = new Map<string, EventSubscription>()
  private gatewayStates = new Map<string, GatewayJoinState>()
  private history = new Map<string, HistoryEntry[]>()
  private timers = new Map<string, ScheduledTimer>()
  private compensationRecords = new Map<string, CompensationRecord[]>()

  private definitionKey(id: string, version: number): string {
    return `${id}@${version}`
  }

  // ─── Definitions ────────────────────────────────────────────────────────────

  async saveDefinition(definition: ProcessDefinition): Promise<void> {
    this.definitions.set(this.definitionKey(definition.id, definition.version), definition)
  }

  async getDefinition(id: string, version?: number): Promise<ProcessDefinition | null> {
    if (version !== undefined) {
      return this.definitions.get(this.definitionKey(id, version)) ?? null
    }
    // Return latest version
    let latest: ProcessDefinition | null = null
    for (const def of this.definitions.values()) {
      if (def.id === id && (latest === null || def.version > latest.version)) {
        latest = def
      }
    }
    return latest
  }

  async listDefinitions(filter?: { isDeployable?: boolean }): Promise<ProcessDefinitionSummary[]> {
    const results: ProcessDefinitionSummary[] = []
    for (const def of this.definitions.values()) {
      if (filter?.isDeployable !== undefined && def.isDeployable !== filter.isDeployable) continue
      results.push({
        id: def.id,
        version: def.version,
        ...(def.name !== undefined ? { name: def.name } : {}),
        deployedAt: def.deployedAt,
        isDeployable: def.isDeployable,
      })
    }
    return results
  }

  // ─── Instances ───────────────────────────────────────────────────────────────

  async createInstance(instance: ProcessInstance): Promise<void> {
    this.instances.set(instance.id, { ...instance })
  }

  async updateInstance(instance: ProcessInstance): Promise<void> {
    this.instances.set(instance.id, { ...instance })
  }

  async getInstance(id: string): Promise<ProcessInstance | null> {
    return this.instances.get(id) ?? null
  }

  async findInstances(query: InstanceQuery): Promise<PagedResult<ProcessInstanceSummary>> {
    let results = [...this.instances.values()]

    if (query.definitionId) results = results.filter(i => i.definitionId === query.definitionId)
    if (query.correlationKey) results = results.filter(i => i.correlationKey === query.correlationKey)
    if (query.businessKey) results = results.filter(i => i.businessKey === query.businessKey)
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status]
      results = results.filter(i => statuses.includes(i.status))
    }
    if (query.startedAfter) { const after = query.startedAfter; results = results.filter(i => i.startedAt >= after) }
    if (query.startedBefore) { const before = query.startedBefore; results = results.filter(i => i.startedAt <= before) }

    const total = results.length
    const items = results
      .slice(query.page * query.pageSize, (query.page + 1) * query.pageSize)
      .map(i => ({
        id: i.id,
        definitionId: i.definitionId,
        definitionVersion: i.definitionVersion,
        status: i.status,
        ...(i.correlationKey !== undefined ? { correlationKey: i.correlationKey } : {}),
        ...(i.businessKey !== undefined ? { businessKey: i.businessKey } : {}),
        startedAt: i.startedAt,
        ...(i.completedAt !== undefined ? { completedAt: i.completedAt } : {}),
      }))

    return { items, total, page: query.page, pageSize: query.pageSize }
  }

  // ─── Tokens ──────────────────────────────────────────────────────────────────

  async saveTokens(tokens: Token[]): Promise<void> {
    for (const token of tokens) {
      const existing = this.tokens.get(token.instanceId) ?? []
      const idx = existing.findIndex(t => t.id === token.id)
      if (idx >= 0) {
        existing[idx] = { ...token }
      } else {
        existing.push({ ...token })
      }
      this.tokens.set(token.instanceId, existing)
    }
  }

  async getActiveTokens(instanceId: string): Promise<Token[]> {
    return (this.tokens.get(instanceId) ?? []).filter(
      t => t.status === 'active' || t.status === 'waiting' || t.status === 'suspended',
    )
  }

  async getAllTokens(instanceId: string): Promise<Token[]> {
    return [...(this.tokens.get(instanceId) ?? [])]
  }

  // ─── Scopes ──────────────────────────────────────────────────────────────────

  async saveScope(scope: VariableScope): Promise<void> {
    this.scopes.set(scope.id, { ...scope, variables: { ...scope.variables } })
  }

  async getScope(id: string): Promise<VariableScope | null> {
    return this.scopes.get(id) ?? null
  }

  async getScopeChain(leafScopeId: string): Promise<VariableScope[]> {
    const chain: VariableScope[] = []
    let current = this.scopes.get(leafScopeId)
    while (current) {
      chain.push(current)
      current = current.parentScopeId ? this.scopes.get(current.parentScopeId) : undefined
    }
    return chain
  }

  // ─── User Tasks ──────────────────────────────────────────────────────────────

  async createUserTask(task: UserTaskRecord): Promise<void> {
    this.userTasks.set(task.id, { ...task })
  }

  async updateUserTask(task: UserTaskRecord): Promise<void> {
    this.userTasks.set(task.id, { ...task })
  }

  async getUserTask(id: string): Promise<UserTaskRecord | null> {
    return this.userTasks.get(id) ?? null
  }

  async queryUserTasks(query: UserTaskQuery): Promise<PagedResult<UserTaskRecord>> {
    let results = [...this.userTasks.values()]

    if (query.instanceId) results = results.filter(t => t.instanceId === query.instanceId)
    if (query.assignee) results = results.filter(t => t.assignee === query.assignee)
    if (query.candidateGroup) {
      const group = query.candidateGroup; results = results.filter(t => t.candidateGroups?.includes(group))
    }
    if (query.status) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status]
      results = results.filter(t => statuses.includes(t.status))
    }

    const total = results.length
    const items = results.slice(query.page * query.pageSize, (query.page + 1) * query.pageSize)

    return { items, total, page: query.page, pageSize: query.pageSize }
  }

  // ─── Subscriptions ───────────────────────────────────────────────────────────

  async saveSubscription(subscription: EventSubscription): Promise<void> {
    this.subscriptions.set(subscription.id, { ...subscription })
  }

  async deleteSubscription(id: string): Promise<void> {
    this.subscriptions.delete(id)
  }

  async findSubscriptions(filter: SubscriptionFilter): Promise<EventSubscription[]> {
    return [...this.subscriptions.values()].filter(s => {
      if (s.status !== 'active') return false
      if (filter.type && s.type !== filter.type) return false
      if (filter.messageName && s.messageName !== filter.messageName) return false
      if (filter.signalName && s.signalName !== filter.signalName) return false
      if (filter.correlationValue && s.correlationValue !== filter.correlationValue) return false
      if (filter.instanceId && s.instanceId !== filter.instanceId) return false
      return true
    })
  }

  // ─── Gateway State ───────────────────────────────────────────────────────────

  async saveGatewayState(state: GatewayJoinState): Promise<void> {
    this.gatewayStates.set(gatewayKey(state.gatewayId, state.instanceId), { ...state } as GatewayJoinState)
  }

  async getGatewayState(gatewayId: string, instanceId: string): Promise<GatewayJoinState | null> {
    return this.gatewayStates.get(gatewayKey(gatewayId, instanceId)) ?? null
  }

  async deleteGatewayState(gatewayId: string, instanceId: string): Promise<void> {
    this.gatewayStates.delete(gatewayKey(gatewayId, instanceId))
  }

  async listGatewayStates(instanceId: string): Promise<GatewayJoinState[]> {
    return [...this.gatewayStates.values()].filter(s => s.instanceId === instanceId)
  }

  // ─── History ─────────────────────────────────────────────────────────────────

  async appendHistory(entry: HistoryEntry): Promise<void> {
    const existing = this.history.get(entry.instanceId) ?? []
    existing.push({ ...entry })
    this.history.set(entry.instanceId, existing)
  }

  async getHistory(instanceId: string): Promise<HistoryEntry[]> {
    return [...(this.history.get(instanceId) ?? [])]
  }

  // ─── Timers ──────────────────────────────────────────────────────────────────

  async saveTimer(timer: ScheduledTimer): Promise<void> {
    this.timers.set(timer.id, { ...timer })
  }

  async deleteTimer(id: string): Promise<void> {
    this.timers.delete(id)
  }

  async getDueTimers(before: Date): Promise<ScheduledTimer[]> {
    return [...this.timers.values()].filter(t => t.fireAt <= before)
  }

  // ─── Compensation ─────────────────────────────────────────────────────────────

  async saveCompensationRecord(record: CompensationRecord): Promise<void> {
    const existing = this.compensationRecords.get(record.instanceId) ?? []
    this.compensationRecords.set(record.instanceId, [...existing, { ...record }])
  }

  async deleteCompensationRecord(instanceId: string, tokenId: string): Promise<void> {
    const existing = this.compensationRecords.get(instanceId) ?? []
    this.compensationRecords.set(instanceId, existing.filter(r => r.tokenId !== tokenId))
  }

  async listCompensationRecords(instanceId: string): Promise<CompensationRecord[]> {
    return [...(this.compensationRecords.get(instanceId) ?? [])]
  }

  // ─── Transaction (in-memory: serial, no rollback needed) ─────────────────────

  async executeTransaction(ops: StoreOperation[]): Promise<void> {
    for (const op of ops) {
      switch (op.op) {
        case 'saveDefinition':    await this.saveDefinition(op.definition); break
        case 'createInstance':    await this.createInstance(op.instance); break
        case 'updateInstance':    await this.updateInstance(op.instance); break
        case 'saveTokens':        await this.saveTokens(op.tokens); break
        case 'saveScope':         await this.saveScope(op.scope); break
        case 'createUserTask':    await this.createUserTask(op.task); break
        case 'updateUserTask':    await this.updateUserTask(op.task); break
        case 'saveSubscription':  await this.saveSubscription(op.subscription); break
        case 'deleteSubscription':await this.deleteSubscription(op.id); break
        case 'saveGatewayState':  await this.saveGatewayState(op.state); break
        case 'deleteGatewayState':await this.deleteGatewayState(op.gatewayId, op.instanceId); break
        case 'appendHistory':     await this.appendHistory(op.entry); break
        case 'saveTimer':               await this.saveTimer(op.timer); break
        case 'deleteTimer':             await this.deleteTimer(op.id); break
        case 'saveCompensationRecord':  await this.saveCompensationRecord(op.record); break
        case 'deleteCompensationRecord': await this.deleteCompensationRecord(op.instanceId, op.tokenId); break
      }
    }
  }

  // ─── Test Helpers (not part of StateStore interface) ─────────────────────────

  /** Reset all state — useful in beforeEach() */
  reset(): void {
    this.definitions.clear()
    this.instances.clear()
    this.tokens.clear()
    this.scopes.clear()
    this.userTasks.clear()
    this.subscriptions.clear()
    this.gatewayStates.clear()
    this.history.clear()
    this.timers.clear()
    this.compensationRecords.clear()
  }

  /** Snapshot all active instances — useful for assertions */
  getAllInstances(): ProcessInstance[] {
    return [...this.instances.values()]
  }

  /** Snapshot all subscriptions — useful for assertions */
  getAllSubscriptions(): EventSubscription[] {
    return [...this.subscriptions.values()]
  }

  /** Snapshot all timers — useful for assertions */
  getAllTimers(): ScheduledTimer[] {
    return [...this.timers.values()]
  }
}
