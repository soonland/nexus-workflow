import postgres from 'postgres'
import type {
  StateStore,
  InstanceQuery,
  UserTaskQuery,
  SubscriptionFilter,
  PagedResult,
  ProcessDefinitionSummary,
  ProcessInstanceSummary,
  StoreOperation,
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
} from 'nexus-workflow-core'

// ─── Internal SQL alias ───────────────────────────────────────────────────────
// Both postgres.Sql and postgres.TransactionSql support the same query API.
// We accept either via this alias to avoid duplicating method signatures.
type AnySql = postgres.Sql | postgres.TransactionSql

// ─── Date Reviver Helpers ─────────────────────────────────────────────────────

function reviveRequiredDate(value: string): Date {
  return new Date(value)
}

function reviveOptionalDate(value: string | null | undefined): Date | undefined {
  if (value == null) return undefined
  return new Date(value)
}

// Raw shapes — as they come out of JSONB (Dates are strings)

type RawProcessDefinition = Omit<ProcessDefinition, 'deployedAt'> & {
  deployedAt: string
}

function reviveDefinition(raw: RawProcessDefinition): ProcessDefinition {
  const def: ProcessDefinition = {
    id: raw.id,
    version: raw.version,
    elements: raw.elements,
    sequenceFlows: raw.sequenceFlows,
    startEventId: raw.startEventId,
    deployedAt: reviveRequiredDate(raw.deployedAt),
    isDeployable: raw.isDeployable,
  }
  if (raw.name !== undefined) def.name = raw.name
  return def
}

type RawProcessInstance = Omit<ProcessInstance, 'startedAt' | 'completedAt'> & {
  startedAt: string
  completedAt?: string | null
}

function reviveInstance(raw: RawProcessInstance): ProcessInstance {
  const base: ProcessInstance = {
    id: raw.id,
    definitionId: raw.definitionId,
    definitionVersion: raw.definitionVersion,
    status: raw.status,
    rootScopeId: raw.rootScopeId,
    startedAt: reviveRequiredDate(raw.startedAt),
  }
  if (raw.correlationKey !== undefined) base.correlationKey = raw.correlationKey
  if (raw.businessKey !== undefined) base.businessKey = raw.businessKey
  if (raw.parentInstanceId !== undefined) base.parentInstanceId = raw.parentInstanceId
  if (raw.parentTokenId !== undefined) base.parentTokenId = raw.parentTokenId
  if (raw.errorInfo !== undefined) base.errorInfo = raw.errorInfo
  const completedAt = reviveOptionalDate(raw.completedAt)
  if (completedAt !== undefined) base.completedAt = completedAt
  return base
}

type RawToken = Omit<Token, 'createdAt' | 'updatedAt'> & {
  createdAt: string
  updatedAt: string
}

function reviveToken(raw: RawToken): Token {
  const base: Token = {
    id: raw.id,
    instanceId: raw.instanceId,
    elementId: raw.elementId,
    elementType: raw.elementType,
    status: raw.status,
    scopeId: raw.scopeId,
    createdAt: reviveRequiredDate(raw.createdAt),
    updatedAt: reviveRequiredDate(raw.updatedAt),
  }
  if (raw.arrivedViaFlowId !== undefined) base.arrivedViaFlowId = raw.arrivedViaFlowId
  if (raw.parentTokenId !== undefined) base.parentTokenId = raw.parentTokenId
  if (raw.subProcessInstanceId !== undefined) base.subProcessInstanceId = raw.subProcessInstanceId
  if (raw.waitingFor !== undefined) base.waitingFor = raw.waitingFor
  return base
}

type RawHistoryEntry = Omit<HistoryEntry, 'startedAt' | 'completedAt'> & {
  startedAt: string
  completedAt: string
}

function reviveHistoryEntry(raw: RawHistoryEntry): HistoryEntry {
  const base: HistoryEntry = {
    id: raw.id,
    instanceId: raw.instanceId,
    tokenId: raw.tokenId,
    elementId: raw.elementId,
    elementType: raw.elementType,
    status: raw.status,
    startedAt: reviveRequiredDate(raw.startedAt),
    completedAt: reviveRequiredDate(raw.completedAt),
  }
  if (raw.variablesSnapshot !== undefined) base.variablesSnapshot = raw.variablesSnapshot
  return base
}

type RawEventSubscription = Omit<EventSubscription, 'createdAt'> & {
  createdAt: string
}

function reviveEventSubscription(raw: RawEventSubscription): EventSubscription {
  const base: EventSubscription = {
    id: raw.id,
    instanceId: raw.instanceId,
    tokenId: raw.tokenId,
    type: raw.type,
    status: raw.status,
    createdAt: reviveRequiredDate(raw.createdAt),
  }
  if (raw.messageName !== undefined) base.messageName = raw.messageName
  if (raw.signalName !== undefined) base.signalName = raw.signalName
  if (raw.correlationValue !== undefined) base.correlationValue = raw.correlationValue
  if (raw.errorCode !== undefined) base.errorCode = raw.errorCode
  if (raw.timerId !== undefined) base.timerId = raw.timerId
  return base
}

type RawScheduledTimer = Omit<ScheduledTimer, 'fireAt' | 'createdAt'> & {
  fireAt: string
  createdAt: string
}

function reviveScheduledTimer(raw: RawScheduledTimer): ScheduledTimer {
  return {
    id: raw.id,
    instanceId: raw.instanceId,
    tokenId: raw.tokenId,
    fireAt: reviveRequiredDate(raw.fireAt),
    createdAt: reviveRequiredDate(raw.createdAt),
  }
}

type RawUserTaskRecord = Omit<UserTaskRecord, 'createdAt' | 'claimedAt' | 'completedAt' | 'dueDate'> & {
  createdAt: string
  claimedAt?: string | null
  completedAt?: string | null
  dueDate?: string | null
}

function reviveUserTaskRecord(raw: RawUserTaskRecord): UserTaskRecord {
  const base: UserTaskRecord = {
    id: raw.id,
    instanceId: raw.instanceId,
    tokenId: raw.tokenId,
    elementId: raw.elementId,
    name: raw.name,
    priority: raw.priority,
    inputVariables: raw.inputVariables,
    status: raw.status,
    createdAt: reviveRequiredDate(raw.createdAt),
  }
  if (raw.assignee !== undefined) base.assignee = raw.assignee
  if (raw.description !== undefined) base.description = raw.description
  if (raw.candidateGroups !== undefined) base.candidateGroups = raw.candidateGroups
  if (raw.formKey !== undefined) base.formKey = raw.formKey
  const claimedAt = reviveOptionalDate(raw.claimedAt)
  if (claimedAt !== undefined) base.claimedAt = claimedAt
  const completedAt = reviveOptionalDate(raw.completedAt)
  if (completedAt !== undefined) base.completedAt = completedAt
  const dueDate = reviveOptionalDate(raw.dueDate)
  if (dueDate !== undefined) base.dueDate = dueDate
  return base
}

// ─── PostgresStateStore ───────────────────────────────────────────────────────

export class PostgresStateStore implements StateStore {
  private readonly sql: postgres.Sql

  constructor(connectionString: string, tenantId: string) {
    this.sql = postgres(connectionString, {
      connection: {
        // Sets search_path for every connection in this pool so all unqualified
        // table references resolve to the tenant's schema first, then public.
        search_path: `tenant_${tenantId}, public`,
      },
    })
  }

  /** Gracefully close the connection pool. */
  async end(): Promise<void> {
    await this.sql.end()
  }

  /** Alias for end() — documented public API. */
  async close(): Promise<void> {
    await this.sql.end()
  }

  // ─── Process Definitions ───────────────────────────────────────────────────

  async saveDefinition(definition: ProcessDefinition): Promise<void> {
    await this.saveDefinitionWith(this.sql, definition)
  }

  private async saveDefinitionWith(db: AnySql, definition: ProcessDefinition): Promise<void> {
    const sql = db as postgres.Sql
    const row = {
      id: definition.id,
      version: definition.version,
      name: definition.name ?? null,
      deployed_at: definition.deployedAt,
      is_deployable: definition.isDeployable,
      data: sql.json(definition as unknown as postgres.JSONValue),
    }
    await sql`
      INSERT INTO definitions ${sql(row)}
      ON CONFLICT (id, version) DO UPDATE
        SET name          = EXCLUDED.name,
            deployed_at   = EXCLUDED.deployed_at,
            is_deployable = EXCLUDED.is_deployable,
            data          = EXCLUDED.data
    `
  }

  async getDefinition(id: string, version?: number): Promise<ProcessDefinition | null> {
    type Row = { data: RawProcessDefinition }
    let rows: Row[]
    if (version !== undefined) {
      rows = await this.sql<Row[]>`
        SELECT data FROM definitions WHERE id = ${id} AND version = ${version}
      `
    } else {
      rows = await this.sql<Row[]>`
        SELECT data FROM definitions WHERE id = ${id} ORDER BY version DESC LIMIT 1
      `
    }
    if (rows.length === 0) return null
    const row = rows[0] as Row
    return reviveDefinition(row.data)
  }

  async saveDefinitionXml(id: string, version: number, xml: string): Promise<void> {
    await this.sql`
      UPDATE definitions SET source_xml = ${xml} WHERE id = ${id} AND version = ${version}
    `
  }

  async getDefinitionXml(id: string, version?: number): Promise<string | null> {
    type Row = { source_xml: string | null }
    let rows: Row[]
    if (version !== undefined) {
      rows = await this.sql<Row[]>`
        SELECT source_xml FROM definitions WHERE id = ${id} AND version = ${version}
      `
    } else {
      rows = await this.sql<Row[]>`
        SELECT source_xml FROM definitions WHERE id = ${id} ORDER BY version DESC LIMIT 1
      `
    }
    return rows[0]?.source_xml ?? null
  }

  async deleteDefinition(id: string): Promise<void> {
    await this.sql`DELETE FROM definitions WHERE id = ${id}`
  }

  async listDefinitions(filter?: { isDeployable?: boolean }): Promise<ProcessDefinitionSummary[]> {
    type Row = {
      id: string
      version: number
      name: string | null
      deployed_at: string
      is_deployable: boolean
    }
    let rows: Row[]
    if (filter?.isDeployable !== undefined) {
      rows = await this.sql<Row[]>`
        SELECT id, version, name, deployed_at, is_deployable
        FROM definitions
        WHERE is_deployable = ${filter.isDeployable}
        ORDER BY id, version DESC
      `
    } else {
      rows = await this.sql<Row[]>`
        SELECT id, version, name, deployed_at, is_deployable
        FROM definitions
        ORDER BY id, version DESC
      `
    }
    return rows.map((r): ProcessDefinitionSummary => {
      const summary: ProcessDefinitionSummary = {
        id: r.id,
        version: r.version,
        deployedAt: new Date(r.deployed_at),
        isDeployable: r.is_deployable,
      }
      if (r.name !== null) summary.name = r.name
      return summary
    })
  }

  // ─── Process Instances ─────────────────────────────────────────────────────

  async createInstance(instance: ProcessInstance): Promise<void> {
    await this.createInstanceWith(this.sql, instance)
  }

  private async createInstanceWith(db: AnySql, instance: ProcessInstance): Promise<void> {
    const sql = db as postgres.Sql
    const row = {
      id: instance.id,
      definition_id: instance.definitionId,
      definition_version: instance.definitionVersion,
      status: instance.status,
      correlation_key: instance.correlationKey ?? null,
      business_key: instance.businessKey ?? null,
      started_at: instance.startedAt,
      completed_at: instance.completedAt ?? null,
      data: sql.json(instance as unknown as postgres.JSONValue),
    }
    await sql`INSERT INTO instances ${sql(row)}`
  }

  async updateInstance(instance: ProcessInstance): Promise<void> {
    await this.updateInstanceWith(this.sql, instance)
  }

  private async updateInstanceWith(db: AnySql, instance: ProcessInstance): Promise<void> {
    const sql = db as postgres.Sql
    await sql`
      UPDATE instances
      SET status          = ${instance.status},
          correlation_key = ${instance.correlationKey ?? null},
          business_key    = ${instance.businessKey ?? null},
          completed_at    = ${instance.completedAt ?? null},
          data            = ${sql.json(instance as unknown as postgres.JSONValue)}
      WHERE id = ${instance.id}
    `
  }

  async getInstance(id: string): Promise<ProcessInstance | null> {
    type Row = { data: RawProcessInstance }
    const rows = await this.sql<Row[]>`SELECT data FROM instances WHERE id = ${id}`
    if (rows.length === 0) return null
    const row = rows[0] as Row
    return reviveInstance(row.data)
  }

  async findInstances(query: InstanceQuery): Promise<PagedResult<ProcessInstanceSummary>> {
    // Build a parameterised WHERE clause dynamically.
    // We collect literal SQL fragments and bind values separately, then join
    // them into a single sql.unsafe() call to avoid N+1 round trips.
    const clauses: string[] = []
    const params: postgres.ParameterOrJSON<never>[] = []

    if (query.definitionId !== undefined) {
      params.push(query.definitionId)
      clauses.push(`definition_id = $${params.length}`)
    }
    if (query.correlationKey !== undefined) {
      params.push(query.correlationKey)
      clauses.push(`correlation_key = $${params.length}`)
    }
    if (query.businessKey !== undefined) {
      params.push(query.businessKey)
      clauses.push(`business_key = $${params.length}`)
    }
    if (query.startedAfter !== undefined) {
      params.push(query.startedAfter)
      clauses.push(`started_at > $${params.length}`)
    }
    if (query.startedBefore !== undefined) {
      params.push(query.startedBefore)
      clauses.push(`started_at < $${params.length}`)
    }
    if (query.status !== undefined) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status]
      params.push(statuses)
      clauses.push(`status = ANY($${params.length})`)
    }

    const offset = query.page * query.pageSize
    const where = clauses.length > 0 ? clauses.join(' AND ') : 'TRUE'

    params.push(query.pageSize)
    const limitPlaceholder = `$${params.length}`
    params.push(offset)
    const offsetPlaceholder = `$${params.length}`

    type ResultRow = { data: RawProcessInstance; total_count: string }

    const rows = await this.sql.unsafe<ResultRow[]>(
      `SELECT data, count(*) OVER() AS total_count
       FROM instances
       WHERE ${where}
       ORDER BY started_at DESC
       LIMIT ${limitPlaceholder}
       OFFSET ${offsetPlaceholder}`,
      params,
    )

    const firstRow = rows[0] as ResultRow | undefined
    const total = firstRow !== undefined ? parseInt(firstRow.total_count, 10) : 0

    const items = rows.map((r): ProcessInstanceSummary => {
      const inst = reviveInstance(r.data)
      const summary: ProcessInstanceSummary = {
        id: inst.id,
        definitionId: inst.definitionId,
        definitionVersion: inst.definitionVersion,
        status: inst.status,
        startedAt: inst.startedAt,
      }
      if (inst.correlationKey !== undefined) summary.correlationKey = inst.correlationKey
      if (inst.businessKey !== undefined) summary.businessKey = inst.businessKey
      if (inst.completedAt !== undefined) summary.completedAt = inst.completedAt
      return summary
    })

    return { items, total, page: query.page, pageSize: query.pageSize }
  }

  // ─── Tokens ────────────────────────────────────────────────────────────────

  async saveTokens(tokens: Token[]): Promise<void> {
    await this.saveTokensWith(this.sql, tokens)
  }

  private async saveTokensWith(db: AnySql, tokens: Token[]): Promise<void> {
    if (tokens.length === 0) return
    const sql = db as postgres.Sql
    for (const token of tokens) {
      const row = {
        id: token.id,
        instance_id: token.instanceId,
        status: token.status,
        data: sql.json(token as unknown as postgres.JSONValue),
      }
      await sql`
        INSERT INTO tokens ${sql(row)}
        ON CONFLICT (id) DO UPDATE
          SET status = EXCLUDED.status,
              data   = EXCLUDED.data
      `
    }
  }

  async getActiveTokens(instanceId: string): Promise<Token[]> {
    type Row = { data: RawToken }
    const rows = await this.sql<Row[]>`
      SELECT data FROM tokens
      WHERE instance_id = ${instanceId}
        AND status IN ('active', 'waiting', 'suspended')
    `
    return rows.map((r) => reviveToken(r.data))
  }

  async getAllTokens(instanceId: string): Promise<Token[]> {
    type Row = { data: RawToken }
    const rows = await this.sql<Row[]>`
      SELECT data FROM tokens WHERE instance_id = ${instanceId}
    `
    return rows.map((r) => reviveToken(r.data))
  }

  // ─── Variable Scopes ───────────────────────────────────────────────────────

  async saveScope(scope: VariableScope): Promise<void> {
    await this.saveScopeWith(this.sql, scope)
  }

  private async saveScopeWith(db: AnySql, scope: VariableScope): Promise<void> {
    const sql = db as postgres.Sql
    const row = {
      id: scope.id,
      parent_scope_id: scope.parentScopeId ?? null,
      data: sql.json(scope as unknown as postgres.JSONValue),
    }
    await sql`
      INSERT INTO variable_scopes ${sql(row)}
      ON CONFLICT (id) DO UPDATE
        SET parent_scope_id = EXCLUDED.parent_scope_id,
            data            = EXCLUDED.data
    `
  }

  async getScope(id: string): Promise<VariableScope | null> {
    type Row = { data: VariableScope }
    const rows = await this.sql<Row[]>`SELECT data FROM variable_scopes WHERE id = ${id}`
    if (rows.length === 0) return null
    const row = rows[0] as Row
    return row.data
  }

  async getScopeChain(leafScopeId: string): Promise<VariableScope[]> {
    const chain: VariableScope[] = []
    let currentId: string | undefined = leafScopeId
    while (currentId) {
      const scope = await this.getScope(currentId)
      if (!scope) break
      chain.push(scope)
      currentId = scope.parentScopeId
    }
    return chain
  }

  // ─── User Tasks ────────────────────────────────────────────────────────────

  async createUserTask(task: UserTaskRecord): Promise<void> {
    await this.createUserTaskWith(this.sql, task)
  }

  private async createUserTaskWith(db: AnySql, task: UserTaskRecord): Promise<void> {
    const sql = db as postgres.Sql
    const row = {
      id: task.id,
      instance_id: task.instanceId,
      assignee: task.assignee ?? null,
      status: task.status,
      data: sql.json(task as unknown as postgres.JSONValue),
    }
    await sql`INSERT INTO user_tasks ${sql(row)}`
  }

  async updateUserTask(task: UserTaskRecord): Promise<void> {
    await this.updateUserTaskWith(this.sql, task)
  }

  private async updateUserTaskWith(db: AnySql, task: UserTaskRecord): Promise<void> {
    const sql = db as postgres.Sql
    await sql`
      UPDATE user_tasks
      SET assignee = ${task.assignee ?? null},
          status   = ${task.status},
          data     = ${sql.json(task as unknown as postgres.JSONValue)}
      WHERE id = ${task.id}
    `
  }

  async getUserTask(id: string): Promise<UserTaskRecord | null> {
    type Row = { data: RawUserTaskRecord }
    const rows = await this.sql<Row[]>`SELECT data FROM user_tasks WHERE id = ${id}`
    if (rows.length === 0) return null
    const row = rows[0] as Row
    return reviveUserTaskRecord(row.data)
  }

  async queryUserTasks(query: UserTaskQuery): Promise<PagedResult<UserTaskRecord>> {
    const clauses: string[] = []
    const params: postgres.ParameterOrJSON<never>[] = []

    if (query.instanceId !== undefined) {
      params.push(query.instanceId)
      clauses.push(`instance_id = $${params.length}`)
    }
    if (query.assignee !== undefined) {
      params.push(query.assignee)
      clauses.push(`assignee = $${params.length}`)
    }
    if (query.candidateGroup !== undefined) {
      // candidateGroups is stored as a JSON array inside the data JSONB column
      params.push(query.candidateGroup)
      clauses.push(`data->'candidateGroups' @> to_jsonb($${params.length}::text)`)
    }
    if (query.status !== undefined) {
      const statuses = Array.isArray(query.status) ? query.status : [query.status]
      params.push(statuses)
      clauses.push(`status = ANY($${params.length})`)
    }

    const offset = query.page * query.pageSize
    const where = clauses.length > 0 ? clauses.join(' AND ') : 'TRUE'

    params.push(query.pageSize)
    const limitPlaceholder = `$${params.length}`
    params.push(offset)
    const offsetPlaceholder = `$${params.length}`

    type ResultRow = { data: RawUserTaskRecord; total_count: string }

    const rows = await this.sql.unsafe<ResultRow[]>(
      `SELECT data, count(*) OVER() AS total_count
       FROM user_tasks
       WHERE ${where}
       ORDER BY (data->>'createdAt') ASC
       LIMIT ${limitPlaceholder}
       OFFSET ${offsetPlaceholder}`,
      params,
    )

    const firstRow = rows[0] as ResultRow | undefined
    const total = firstRow !== undefined ? parseInt(firstRow.total_count, 10) : 0
    const items = rows.map((r) => reviveUserTaskRecord(r.data))

    return { items, total, page: query.page, pageSize: query.pageSize }
  }

  // ─── Event Subscriptions ───────────────────────────────────────────────────

  async saveSubscription(subscription: EventSubscription): Promise<void> {
    await this.saveSubscriptionWith(this.sql, subscription)
  }

  private async saveSubscriptionWith(db: AnySql, subscription: EventSubscription): Promise<void> {
    const sql = db as postgres.Sql
    const row = {
      id: subscription.id,
      instance_id: subscription.instanceId,
      type: subscription.type,
      status: subscription.status,
      message_name: subscription.messageName ?? null,
      signal_name: subscription.signalName ?? null,
      correlation_value: subscription.correlationValue ?? null,
      data: sql.json(subscription as unknown as postgres.JSONValue),
    }
    await sql`
      INSERT INTO event_subscriptions ${sql(row)}
      ON CONFLICT (id) DO UPDATE
        SET type              = EXCLUDED.type,
            status            = EXCLUDED.status,
            message_name      = EXCLUDED.message_name,
            signal_name       = EXCLUDED.signal_name,
            correlation_value = EXCLUDED.correlation_value,
            data              = EXCLUDED.data
    `
  }

  async deleteSubscription(id: string): Promise<void> {
    await this.deleteSubscriptionWith(this.sql, id)
  }

  private async deleteSubscriptionWith(db: AnySql, id: string): Promise<void> {
    const sql = db as postgres.Sql
    await sql`DELETE FROM event_subscriptions WHERE id = ${id}`
  }

  async findSubscriptions(filter: SubscriptionFilter): Promise<EventSubscription[]> {
    const clauses: string[] = ["status = 'active'"]
    const params: postgres.ParameterOrJSON<never>[] = []

    if (filter.instanceId !== undefined) {
      params.push(filter.instanceId)
      clauses.push(`instance_id = $${params.length}`)
    }
    if (filter.type !== undefined) {
      params.push(filter.type)
      clauses.push(`type = $${params.length}`)
    }
    if (filter.messageName !== undefined) {
      params.push(filter.messageName)
      clauses.push(`message_name = $${params.length}`)
    }
    if (filter.signalName !== undefined) {
      params.push(filter.signalName)
      clauses.push(`signal_name = $${params.length}`)
    }
    if (filter.correlationValue !== undefined) {
      params.push(filter.correlationValue)
      clauses.push(`correlation_value = $${params.length}`)
    }

    type Row = { data: RawEventSubscription }

    const rows = await this.sql.unsafe<Row[]>(
      `SELECT data FROM event_subscriptions WHERE ${clauses.join(' AND ')}`,
      params,
    )
    return rows.map((r) => reviveEventSubscription(r.data))
  }

  // ─── Gateway Join State ────────────────────────────────────────────────────

  async saveGatewayState(state: GatewayJoinState): Promise<void> {
    await this.saveGatewayStateWith(this.sql, state)
  }

  private async saveGatewayStateWith(db: AnySql, state: GatewayJoinState): Promise<void> {
    const sql = db as postgres.Sql
    const row = {
      gateway_id: state.gatewayId,
      instance_id: state.instanceId,
      data: sql.json(state as unknown as postgres.JSONValue),
    }
    await sql`
      INSERT INTO gateway_join_states ${sql(row)}
      ON CONFLICT (gateway_id, instance_id) DO UPDATE
        SET data = EXCLUDED.data
    `
  }

  async getGatewayState(gatewayId: string, instanceId: string): Promise<GatewayJoinState | null> {
    type Row = { data: GatewayJoinState }
    const rows = await this.sql<Row[]>`
      SELECT data FROM gateway_join_states
      WHERE gateway_id = ${gatewayId} AND instance_id = ${instanceId}
    `
    if (rows.length === 0) return null
    const row = rows[0] as Row
    return row.data
  }

  async deleteGatewayState(gatewayId: string, instanceId: string): Promise<void> {
    await this.deleteGatewayStateWith(this.sql, gatewayId, instanceId)
  }

  private async deleteGatewayStateWith(db: AnySql, gatewayId: string, instanceId: string): Promise<void> {
    const sql = db as postgres.Sql
    await sql`
      DELETE FROM gateway_join_states
      WHERE gateway_id = ${gatewayId} AND instance_id = ${instanceId}
    `
  }

  async listGatewayStates(instanceId: string): Promise<GatewayJoinState[]> {
    return this.listGatewayStatesWith(this.sql, instanceId)
  }

  private async listGatewayStatesWith(db: AnySql, instanceId: string): Promise<GatewayJoinState[]> {
    const sql = db as postgres.Sql
    type Row = { data: GatewayJoinState }
    const rows = await sql<Row[]>`
      SELECT data FROM gateway_join_states WHERE instance_id = ${instanceId}
    `
    return rows.map(r => r.data)
  }

  // ─── History ───────────────────────────────────────────────────────────────

  async appendHistory(entry: HistoryEntry): Promise<void> {
    await this.appendHistoryWith(this.sql, entry)
  }

  private async appendHistoryWith(db: AnySql, entry: HistoryEntry): Promise<void> {
    const sql = db as postgres.Sql
    const row = {
      id: entry.id,
      instance_id: entry.instanceId,
      started_at: entry.startedAt,
      data: sql.json(entry as unknown as postgres.JSONValue),
    }
    await sql`INSERT INTO history_entries ${sql(row)}`
  }

  async getHistory(instanceId: string): Promise<HistoryEntry[]> {
    type Row = { data: RawHistoryEntry }
    const rows = await this.sql<Row[]>`
      SELECT data FROM history_entries
      WHERE instance_id = ${instanceId}
      ORDER BY started_at ASC
    `
    return rows.map((r) => reviveHistoryEntry(r.data))
  }

  // ─── Timers ────────────────────────────────────────────────────────────────

  async saveTimer(timer: ScheduledTimer): Promise<void> {
    await this.saveTimerWith(this.sql, timer)
  }

  private async saveTimerWith(db: AnySql, timer: ScheduledTimer): Promise<void> {
    const sql = db as postgres.Sql
    const row = {
      id: timer.id,
      instance_id: timer.instanceId,
      fire_at: timer.fireAt,
      data: sql.json(timer as unknown as postgres.JSONValue),
    }
    await sql`
      INSERT INTO scheduled_timers ${sql(row)}
      ON CONFLICT (id) DO UPDATE
        SET fire_at = EXCLUDED.fire_at,
            data    = EXCLUDED.data
    `
  }

  async deleteTimer(id: string): Promise<void> {
    await this.deleteTimerWith(this.sql, id)
  }

  private async deleteTimerWith(db: AnySql, id: string): Promise<void> {
    const sql = db as postgres.Sql
    await sql`DELETE FROM scheduled_timers WHERE id = ${id}`
  }

  async getDueTimers(before: Date): Promise<ScheduledTimer[]> {
    type Row = { data: RawScheduledTimer }
    const rows = await this.sql<Row[]>`
      SELECT data FROM scheduled_timers
      WHERE fire_at <= ${before}
      ORDER BY fire_at ASC
    `
    return rows.map((r) => reviveScheduledTimer(r.data))
  }

  // ─── Compensation Records ──────────────────────────────────────────────────

  async saveCompensationRecord(record: CompensationRecord): Promise<void> {
    await this.saveCompensationRecordWith(this.sql, record)
  }

  private async saveCompensationRecordWith(db: AnySql, record: CompensationRecord): Promise<void> {
    const sql = db as postgres.Sql
    await sql`
      INSERT INTO compensation_records (instance_id, activity_id, token_id, handler_id, completed_at)
      VALUES (${record.instanceId}, ${record.activityId}, ${record.tokenId}, ${record.handlerId}, ${record.completedAt})
      ON CONFLICT DO NOTHING
    `
  }

  async deleteCompensationRecord(instanceId: string, tokenId: string): Promise<void> {
    await this.deleteCompensationRecordWith(this.sql, instanceId, tokenId)
  }

  private async deleteCompensationRecordWith(db: AnySql, instanceId: string, tokenId: string): Promise<void> {
    const sql = db as postgres.Sql
    await sql`
      DELETE FROM compensation_records
      WHERE instance_id = ${instanceId} AND token_id = ${tokenId}
    `
  }

  async listCompensationRecords(instanceId: string): Promise<CompensationRecord[]> {
    const rows = await this.sql<{ instance_id: string; activity_id: string; token_id: string; handler_id: string; completed_at: string }[]>`
      SELECT instance_id, activity_id, token_id, handler_id, completed_at
      FROM compensation_records
      WHERE instance_id = ${instanceId}
      ORDER BY completed_at ASC
    `
    return rows.map(r => ({
      instanceId: r.instance_id,
      activityId: r.activity_id,
      tokenId: r.token_id,
      handlerId: r.handler_id,
      completedAt: new Date(r.completed_at),
    }))
  }

  // ─── Atomic Transaction ────────────────────────────────────────────────────

  async executeTransaction(ops: StoreOperation[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      for (const op of ops) {
        await this.applyOp(tx, op)
      }
    })
  }

  private async applyOp(tx: postgres.TransactionSql, op: StoreOperation): Promise<void> {
    switch (op.op) {
      case 'saveDefinition':
        await this.saveDefinitionWith(tx, op.definition)
        break
      case 'createInstance':
        await this.createInstanceWith(tx, op.instance)
        break
      case 'updateInstance':
        await this.updateInstanceWith(tx, op.instance)
        break
      case 'saveTokens':
        await this.saveTokensWith(tx, op.tokens)
        break
      case 'saveScope':
        await this.saveScopeWith(tx, op.scope)
        break
      case 'createUserTask':
        await this.createUserTaskWith(tx, op.task)
        break
      case 'updateUserTask':
        await this.updateUserTaskWith(tx, op.task)
        break
      case 'saveSubscription':
        await this.saveSubscriptionWith(tx, op.subscription)
        break
      case 'deleteSubscription':
        await this.deleteSubscriptionWith(tx, op.id)
        break
      case 'saveGatewayState':
        await this.saveGatewayStateWith(tx, op.state)
        break
      case 'deleteGatewayState':
        await this.deleteGatewayStateWith(tx, op.gatewayId, op.instanceId)
        break
      case 'appendHistory':
        await this.appendHistoryWith(tx, op.entry)
        break
      case 'saveTimer':
        await this.saveTimerWith(tx, op.timer)
        break
      case 'deleteTimer':
        await this.deleteTimerWith(tx, op.id)
        break
      case 'saveCompensationRecord':
        await this.saveCompensationRecordWith(tx, op.record)
        break
      case 'deleteCompensationRecord':
        await this.deleteCompensationRecordWith(tx, op.instanceId, op.tokenId)
        break
      default: {
        const _exhaustive: never = op
        throw new Error(`Unknown StoreOperation: ${(_exhaustive as StoreOperation).op}`)
      }
    }
  }
}
