// ─── Variable Scope ───────────────────────────────────────────────────────────

export type VariableType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'

export interface VariableValue {
  type: VariableType
  value: unknown
}

export interface VariableScope {
  id: string
  parentScopeId?: string
  variables: Record<string, VariableValue>
}

// ─── Token ────────────────────────────────────────────────────────────────────

export type TokenStatus = 'active' | 'waiting' | 'suspended' | 'cancelled' | 'completed'

export type WaitConditionType = 'user-task' | 'message' | 'signal' | 'timer' | 'external'

export interface WaitCondition {
  type: WaitConditionType
  correlationData?: Record<string, unknown>
}

export interface Token {
  id: string
  instanceId: string
  elementId: string
  elementType: BpmnElementType
  status: TokenStatus
  scopeId: string
  /** The sequence flow through which this token arrived at its current element. */
  arrivedViaFlowId?: string
  parentTokenId?: string
  subProcessInstanceId?: string
  waitingFor?: WaitCondition
  /** Internal engine state for sequential multi-instance loops. Not user-visible. */
  loopState?: { collection: unknown[]; index: number; iterationsRan: number }
  createdAt: Date
  updatedAt: Date
}

// ─── Process Instance ─────────────────────────────────────────────────────────

export type InstanceStatus =
  | 'pending'
  | 'active'
  | 'suspended'
  | 'completed'
  | 'terminated'
  | 'error'

export interface ProcessError {
  code: string
  message: string
  elementId?: string
  tokenId?: string
}

export interface HistoryEntry {
  id: string
  instanceId: string
  tokenId: string
  elementId: string
  elementType: BpmnElementType
  status: 'completed' | 'cancelled' | 'error'
  startedAt: Date
  completedAt: Date
  variablesSnapshot?: Record<string, VariableValue>
}

export interface ProcessInstance {
  id: string
  definitionId: string
  definitionVersion: number
  status: InstanceStatus
  rootScopeId: string
  correlationKey?: string
  businessKey?: string
  parentInstanceId?: string
  parentTokenId?: string
  startedAt: Date
  completedAt?: Date
  errorInfo?: ProcessError
}

// ─── Event Subscriptions ──────────────────────────────────────────────────────

export type EventSubscriptionStatus = 'active' | 'resolved' | 'cancelled'
export type EventSubscriptionType = 'message' | 'signal' | 'timer' | 'error'

export interface EventSubscription {
  id: string
  instanceId: string
  tokenId: string
  type: EventSubscriptionType
  messageName?: string
  signalName?: string
  correlationValue?: string
  errorCode?: string
  timerId?: string
  status: EventSubscriptionStatus
  createdAt: Date
}

// ─── Gateway Join State ───────────────────────────────────────────────────────

export interface ParallelGatewayJoinState {
  gatewayId: string
  instanceId: string
  activationId: string
  arrivedFromFlows: string[]
  expectedFlows: string[]
}

export interface InclusiveGatewayJoinState {
  gatewayId: string
  instanceId: string
  activationId: string
  activatedIncomingFlows: string[]
  arrivedFromFlows: string[]
}

export type GatewayJoinState = ParallelGatewayJoinState | InclusiveGatewayJoinState

// ─── User Task ────────────────────────────────────────────────────────────────

export type UserTaskStatus = 'open' | 'claimed' | 'completed' | 'cancelled'

export interface UserTaskRecord {
  id: string
  instanceId: string
  tokenId: string
  elementId: string
  name: string
  description?: string
  assignee?: string
  candidateGroups?: string[]
  dueDate?: Date
  priority: number
  inputVariables: Record<string, VariableValue>
  formKey?: string
  status: UserTaskStatus
  createdAt: Date
  claimedAt?: Date
  completedAt?: Date
}

// ─── Scheduled Timer ──────────────────────────────────────────────────────────

export interface ScheduledTimer {
  id: string
  instanceId: string
  tokenId: string
  fireAt: Date
  createdAt: Date
}

// ─── BPMN Process Definition ──────────────────────────────────────────────────

export type BpmnElementType =
  // Events
  | 'startEvent'
  | 'endEvent'
  | 'intermediateCatchEvent'
  | 'intermediateThrowEvent'
  | 'boundaryEvent'
  // Tasks
  | 'serviceTask'
  | 'userTask'
  | 'scriptTask'
  | 'manualTask'
  | 'callActivity'
  // Gateways
  | 'exclusiveGateway'
  | 'parallelGateway'
  | 'inclusiveGateway'
  | 'eventBasedGateway'
  // Sub-processes
  | 'subProcess'
  // Structural
  | 'sequenceFlow'

export type EventDefinitionType =
  | 'none'
  | 'timer'
  | 'message'
  | 'signal'
  | 'error'
  | 'terminate'
  | 'compensation'
  | 'escalation'
  | 'conditional'
  | 'link'

export interface EventDefinition {
  type: EventDefinitionType
  /** For timer events: ISO 8601 duration, date, or cron */
  timerExpression?: string
  messageName?: string
  signalName?: string
  errorCode?: string
  linkName?: string
}

export interface SequenceFlow {
  id: string
  sourceRef: string
  targetRef: string
  conditionExpression?: string
  isDefault?: boolean
}

export interface BpmnElement {
  id: string
  type: BpmnElementType
  name?: string
  incomingFlows: string[]
  outgoingFlows: string[]
}

export interface StartEventElement extends BpmnElement {
  type: 'startEvent'
  eventDefinition: EventDefinition
}

export interface EndEventElement extends BpmnElement {
  type: 'endEvent'
  eventDefinition: EventDefinition
}

export interface IntermediateCatchEventElement extends BpmnElement {
  type: 'intermediateCatchEvent'
  eventDefinition: EventDefinition
}

export interface IntermediateThrowEventElement extends BpmnElement {
  type: 'intermediateThrowEvent'
  eventDefinition: EventDefinition
}

export interface BoundaryEventElement extends BpmnElement {
  type: 'boundaryEvent'
  attachedToRef: string
  cancelActivity: boolean
  eventDefinition: EventDefinition
}

export interface MultiInstanceLoopCharacteristics {
  isSequential: boolean
  inputCollection: string
  inputElement?: string
  outputElement?: string
  outputCollection?: string
  completionCondition?: string
}

export interface ServiceTaskElement extends BpmnElement {
  type: 'serviceTask'
  taskType?: string
  inputMappings?: VariableMapping[]
  outputMappings?: VariableMapping[]
  retryConfig?: RetryConfig
  loopCharacteristics?: MultiInstanceLoopCharacteristics
}

export interface UserTaskElement extends BpmnElement {
  type: 'userTask'
  assignee?: string
  candidateGroups?: string[]
  dueDate?: string
  priority?: number
  formKey?: string
  loopCharacteristics?: MultiInstanceLoopCharacteristics
}

export interface ScriptTaskElement extends BpmnElement {
  type: 'scriptTask'
  scriptLanguage: string
  script: string
  loopCharacteristics?: MultiInstanceLoopCharacteristics
}

export interface ManualTaskElement extends BpmnElement {
  type: 'manualTask'
  loopCharacteristics?: MultiInstanceLoopCharacteristics
}

export interface CallActivityElement extends BpmnElement {
  type: 'callActivity'
  calledElement: string
  calledElementVersion?: number
  inputMappings?: VariableMapping[]
  outputMappings?: VariableMapping[]
}

export interface GatewayElement extends BpmnElement {
  type: 'exclusiveGateway' | 'parallelGateway' | 'inclusiveGateway' | 'eventBasedGateway'
  defaultFlow?: string
  /**
   * For eventBasedGateway only: true if this is an instantiating variant (not supported).
   * Must not be set on other gateway types.
   */
  instantiate?: boolean
}

export interface SubProcessElement extends BpmnElement {
  type: 'subProcess'
  elements: BpmnFlowElement[]
  sequenceFlows: SequenceFlow[]
  startEventId: string
}

export interface VariableMapping {
  source: string
  target: string
  expression?: string
}

export interface RetryConfig {
  maxRetries: number
  retryDelay: number
  backoffFactor?: number
}

export type BpmnFlowElement =
  | StartEventElement
  | EndEventElement
  | IntermediateCatchEventElement
  | IntermediateThrowEventElement
  | BoundaryEventElement
  | ServiceTaskElement
  | UserTaskElement
  | ScriptTaskElement
  | ManualTaskElement
  | CallActivityElement
  | GatewayElement
  | SubProcessElement

export interface ProcessDefinition {
  id: string
  version: number
  name?: string
  elements: BpmnFlowElement[]
  sequenceFlows: SequenceFlow[]
  startEventId: string
  deployedAt: Date
  isDeployable: boolean
}
