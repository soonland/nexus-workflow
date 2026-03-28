import type {
  ProcessDefinition,
  ProcessInstance,
  Token,
  VariableScope,
  UserTaskRecord,
  UserTaskStatus,
  EventSubscription,
  EventSubscriptionType,
  GatewayJoinState,
  HistoryEntry,
  InstanceStatus,
  ScheduledTimer,
  CompensationRecord,
} from '../model/types.js'

// ─── Query Types ──────────────────────────────────────────────────────────────

export interface InstanceQuery {
  definitionId?: string
  status?: InstanceStatus | InstanceStatus[]
  correlationKey?: string
  businessKey?: string
  startedAfter?: Date
  startedBefore?: Date
  page: number
  pageSize: number
}

export interface UserTaskQuery {
  instanceId?: string
  assignee?: string
  candidateGroup?: string
  status?: UserTaskStatus | UserTaskStatus[]
  page: number
  pageSize: number
}

export interface SubscriptionFilter {
  type?: EventSubscriptionType
  messageName?: string
  signalName?: string
  correlationValue?: string
  instanceId?: string
}

export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type ProcessDefinitionSummary = Pick<
  ProcessDefinition,
  'id' | 'version' | 'name' | 'deployedAt' | 'isDeployable'
>

export type ProcessInstanceSummary = Pick<
  ProcessInstance,
  'id' | 'definitionId' | 'definitionVersion' | 'status' | 'correlationKey' | 'businessKey' | 'startedAt' | 'completedAt'
>

// ─── Transactional Operations ─────────────────────────────────────────────────

export type StoreOperation =
  | { op: 'saveDefinition'; definition: ProcessDefinition }
  | { op: 'createInstance'; instance: ProcessInstance }
  | { op: 'updateInstance'; instance: ProcessInstance }
  | { op: 'saveTokens'; tokens: Token[] }
  | { op: 'saveScope'; scope: VariableScope }
  | { op: 'createUserTask'; task: UserTaskRecord }
  | { op: 'updateUserTask'; task: UserTaskRecord }
  | { op: 'saveSubscription'; subscription: EventSubscription }
  | { op: 'deleteSubscription'; id: string }
  | { op: 'saveGatewayState'; state: GatewayJoinState }
  | { op: 'deleteGatewayState'; gatewayId: string; instanceId: string }
  | { op: 'appendHistory'; entry: HistoryEntry }
  | { op: 'saveTimer'; timer: ScheduledTimer }
  | { op: 'deleteTimer'; id: string }
  | { op: 'saveCompensationRecord'; record: CompensationRecord }
  | { op: 'deleteCompensationRecord'; instanceId: string; tokenId: string }

// ─── State Store Interface ────────────────────────────────────────────────────

export interface StateStore {
  // Process Definitions
  saveDefinition(definition: ProcessDefinition): Promise<void>
  getDefinition(id: string, version?: number): Promise<ProcessDefinition | null>
  listDefinitions(filter?: { isDeployable?: boolean }): Promise<ProcessDefinitionSummary[]>

  // Process Instances
  createInstance(instance: ProcessInstance): Promise<void>
  updateInstance(instance: ProcessInstance): Promise<void>
  getInstance(id: string): Promise<ProcessInstance | null>
  findInstances(query: InstanceQuery): Promise<PagedResult<ProcessInstanceSummary>>

  // Tokens
  saveTokens(tokens: Token[]): Promise<void>
  getActiveTokens(instanceId: string): Promise<Token[]>
  getAllTokens(instanceId: string): Promise<Token[]>

  // Variable Scopes
  saveScope(scope: VariableScope): Promise<void>
  getScope(id: string): Promise<VariableScope | null>
  getScopeChain(leafScopeId: string): Promise<VariableScope[]>

  // User Tasks
  createUserTask(task: UserTaskRecord): Promise<void>
  updateUserTask(task: UserTaskRecord): Promise<void>
  getUserTask(id: string): Promise<UserTaskRecord | null>
  queryUserTasks(query: UserTaskQuery): Promise<PagedResult<UserTaskRecord>>

  // Event Subscriptions
  saveSubscription(subscription: EventSubscription): Promise<void>
  deleteSubscription(id: string): Promise<void>
  findSubscriptions(filter: SubscriptionFilter): Promise<EventSubscription[]>

  // Gateway Join State
  saveGatewayState(state: GatewayJoinState): Promise<void>
  getGatewayState(gatewayId: string, instanceId: string): Promise<GatewayJoinState | null>
  deleteGatewayState(gatewayId: string, instanceId: string): Promise<void>
  listGatewayStates(instanceId: string): Promise<GatewayJoinState[]>

  // History
  appendHistory(entry: HistoryEntry): Promise<void>
  getHistory(instanceId: string): Promise<HistoryEntry[]>

  // Timers
  saveTimer(timer: ScheduledTimer): Promise<void>
  deleteTimer(id: string): Promise<void>
  getDueTimers(before: Date): Promise<ScheduledTimer[]>

  // Compensation
  saveCompensationRecord(record: CompensationRecord): Promise<void>
  deleteCompensationRecord(instanceId: string, tokenId: string): Promise<void>
  listCompensationRecords(instanceId: string): Promise<CompensationRecord[]>

  // Atomic batch
  executeTransaction(ops: StoreOperation[]): Promise<void>
}
