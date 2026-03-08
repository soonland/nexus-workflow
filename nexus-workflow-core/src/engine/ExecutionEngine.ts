import { DefinitionError, RuntimeError } from '../model/errors.js'
import { evaluateExclusiveSplit } from '../gateways/ExclusiveGateway.js'
import { evaluateParallelSplit, evaluateParallelJoin } from '../gateways/ParallelGateway.js'
import { evaluateInclusiveSplit, evaluateInclusiveJoin } from '../gateways/InclusiveGateway.js'
import { JsEvaluator } from '../expression/JsEvaluator.js'
import type { ExpressionEvaluator } from '../interfaces/ExpressionEvaluator.js'
import type {
  ProcessDefinition,
  BpmnFlowElement,
  SequenceFlow,
  Token,
  TokenStatus,
  VariableScope,
  VariableValue,
  ProcessInstance,
  GatewayJoinState,
  ParallelGatewayJoinState,
  InclusiveGatewayJoinState,
  BpmnElementType,
  GatewayElement,
  ServiceTaskElement,
  EndEventElement,
  UserTaskElement,
  ScriptTaskElement,
} from '../model/types.js'
import type { ExecutionEvent } from '../interfaces/EventBus.js'

// ─── Public API types ─────────────────────────────────────────────────────────

export interface EngineState {
  instance: ProcessInstance
  tokens: Token[]
  scopes: VariableScope[]
  gatewayJoinStates: GatewayJoinState[]
}

export type EngineCommand =
  | { type: 'StartProcess'; variables?: Record<string, VariableValue>; correlationKey?: string; businessKey?: string }
  | { type: 'CompleteServiceTask'; tokenId: string; outputVariables?: Record<string, VariableValue> }
  | { type: 'FailServiceTask'; tokenId: string; error: { code: string; message: string } }
  | { type: 'CompleteUserTask'; tokenId: string; completedBy: string; outputVariables?: Record<string, VariableValue> }
  | { type: 'FireTimer'; tokenId: string }

export interface EngineResult {
  newState: EngineState
  events: ExecutionEvent[]
}

export interface ExecuteOptions {
  generateId?: () => string
  now?: () => Date
  /** Expression evaluator used for gateway conditions. Defaults to JsEvaluator. */
  expressionEvaluator?: ExpressionEvaluator
}

const defaultEvaluator = new JsEvaluator()

// ─── Entry point ──────────────────────────────────────────────────────────────

export function execute(
  definition: ProcessDefinition,
  command: EngineCommand,
  state: EngineState | null,
  options: ExecuteOptions = {},
): EngineResult {
  const ctx = new ExecutionContext(state, options)

  switch (command.type) {
    case 'StartProcess':
      handleStartProcess(ctx, command, definition)
      break
    case 'CompleteServiceTask':
      handleCompleteTask(ctx, command.tokenId, command.outputVariables, definition)
      break
    case 'FailServiceTask':
      handleFailServiceTask(ctx, command)
      break
    case 'CompleteUserTask':
      handleCompleteTask(ctx, command.tokenId, command.outputVariables, definition)
      break
    case 'FireTimer':
      handleCompleteTask(ctx, command.tokenId, undefined, definition)
      break
  }

  return ctx.toResult()
}

// ─── Command handlers ─────────────────────────────────────────────────────────

function handleStartProcess(
  ctx: ExecutionContext,
  command: Extract<EngineCommand, { type: 'StartProcess' }>,
  definition: ProcessDefinition,
): void {
  const now = ctx.now()
  const instanceId = ctx.newId()
  const scopeId = ctx.newId()

  const scope: VariableScope = {
    id: scopeId,
    variables: command.variables ?? {},
  }
  ctx.saveScope(scope)

  const instance: ProcessInstance = {
    id: instanceId,
    definitionId: definition.id,
    definitionVersion: definition.version,
    status: 'active',
    rootScopeId: scopeId,
    startedAt: now,
    ...(command.correlationKey !== undefined ? { correlationKey: command.correlationKey } : {}),
    ...(command.businessKey !== undefined ? { businessKey: command.businessKey } : {}),
  }
  ctx.instance = instance

  ctx.emit({ type: 'ProcessInstanceStarted', instanceId, definitionId: definition.id, definitionVersion: definition.version })

  // Place first token at the start event and run
  const startElement = getElement(definition, definition.startEventId)
  const startToken = ctx.createToken(instanceId, startElement.id, startElement.type, scopeId)
  ctx.enqueuePending(startToken)
  runLoop(ctx, definition)
}

function handleCompleteTask(
  ctx: ExecutionContext,
  tokenId: string,
  outputVariables: Record<string, VariableValue> | undefined,
  definition: ProcessDefinition,
): void {
  const token = ctx.requireToken(tokenId)
  if (token.status !== 'waiting') {
    throw new RuntimeError(
      `Cannot complete token "${tokenId}" — status is "${token.status}", expected "waiting"`,
      ctx.instance?.id,
    )
  }

  // Merge output variables into the token's scope
  if (outputVariables && Object.keys(outputVariables).length > 0) {
    ctx.mergeVariables(token.scopeId, outputVariables)
  }

  const element = getElement(definition, token.elementId)
  const elementType = element.type

  ctx.emit({ type: 'ServiceTaskCompleted', instanceId: ctx.instance!.id, tokenId, elementId: token.elementId, durationMs: 0 })

  // Advance through outgoing flows
  advanceToken(ctx, token, element, definition)
  runLoop(ctx, definition)
}

function handleFailServiceTask(
  ctx: ExecutionContext,
  command: Extract<EngineCommand, { type: 'FailServiceTask' }>,
): void {
  const token = ctx.requireToken(command.tokenId)
  if (token.status !== 'waiting') {
    throw new RuntimeError(
      `Cannot fail token "${command.tokenId}" — status is "${token.status}", expected "waiting"`,
    )
  }

  const cancelled: Token = { ...token, status: 'cancelled', updatedAt: ctx.now() }
  ctx.updateToken(cancelled)

  ctx.instance = {
    ...ctx.instance!,
    status: 'error',
    errorInfo: {
      code: command.error.code,
      message: command.error.message,
      tokenId: token.id,
      elementId: token.elementId,
    },
  }

  ctx.emit({
    type: 'ProcessInstanceFaulted',
    instanceId: ctx.instance.id,
    errorCode: command.error.code,
    message: command.error.message,
  })
}

// ─── Execution loop ───────────────────────────────────────────────────────────

function runLoop(ctx: ExecutionContext, definition: ProcessDefinition): void {
  let token = ctx.dequeuePending()
  while (token !== undefined) {
    processToken(ctx, token, definition)
    token = ctx.dequeuePending()
  }
}

function processToken(ctx: ExecutionContext, token: Token, definition: ProcessDefinition): void {
  const element = getElement(definition, token.elementId)

  switch (element.type) {
    case 'startEvent':
      advanceToken(ctx, token, element, definition)
      break
    case 'endEvent':
      handleEndEvent(ctx, token, element as EndEventElement, definition)
      break
    case 'serviceTask':
      handleServiceTask(ctx, token, element as ServiceTaskElement)
      break
    case 'userTask':
      handleUserTask(ctx, token, element as UserTaskElement)
      break
    case 'scriptTask':
      // Script tasks are synchronous — treat like service tasks for now
      suspendToken(ctx, token, 'external')
      break
    case 'manualTask':
      // Manual tasks auto-complete
      advanceToken(ctx, token, element, definition)
      break
    case 'exclusiveGateway':
      handleExclusiveGateway(ctx, token, element as GatewayElement, definition)
      break
    case 'parallelGateway':
      handleParallelGateway(ctx, token, element as GatewayElement, definition)
      break
    case 'inclusiveGateway':
      handleInclusiveGateway(ctx, token, element as GatewayElement, definition)
      break
    default:
      throw new RuntimeError(`Unsupported element type: "${element.type}"`)
  }
}

// ─── Element handlers ─────────────────────────────────────────────────────────

function handleEndEvent(
  ctx: ExecutionContext,
  token: Token,
  element: EndEventElement,
  definition: ProcessDefinition,
): void {
  const completed: Token = { ...token, status: 'completed', updatedAt: ctx.now() }
  ctx.updateToken(completed)

  if (element.eventDefinition.type === 'terminate') {
    // Cancel all other active tokens
    for (const t of ctx.getAllTokens()) {
      if (t.id !== token.id && (t.status === 'active' || t.status === 'waiting')) {
        ctx.updateToken({ ...t, status: 'cancelled', updatedAt: ctx.now() })
        ctx.emit({ type: 'TokenCancelled', instanceId: t.instanceId, tokenId: t.id, elementId: t.elementId })
      }
    }
    completeInstance(ctx)
    return
  }

  // None end event — check if all tokens are done
  const live = ctx.getAllTokens().filter(t => t.status === 'active' || t.status === 'waiting')
  const pending = ctx.pendingCount()
  if (live.length === 0 && pending === 0) {
    completeInstance(ctx)
  }
}

function handleServiceTask(ctx: ExecutionContext, token: Token, element: ServiceTaskElement): void {
  ctx.emit({
    type: 'ServiceTaskStarted',
    instanceId: ctx.instance!.id,
    tokenId: token.id,
    elementId: element.id,
    taskType: element.taskType ?? 'unknown',
  })
  suspendToken(ctx, token, 'external')
}

function handleUserTask(ctx: ExecutionContext, token: Token, _element: UserTaskElement): void {
  suspendToken(ctx, token, 'user-task')
}

function handleExclusiveGateway(
  ctx: ExecutionContext,
  token: Token,
  element: GatewayElement,
  definition: ProcessDefinition,
): void {
  const outgoing = getOutgoingFlows(definition, element.id)
  const incomingFlows = getIncomingFlows(definition, element.id)

  // Join: if multiple incoming flows, this is a join — pass through immediately (XOR semantics)
  // Split: select one outgoing flow
  const isJoin = incomingFlows.length > 1
  const isSplit = outgoing.length > 1 || (outgoing.length === 1 && !isJoin)

  // For XOR, joining is always pass-through — just consume the token and advance
  const scope = ctx.resolveScope(token.scopeId)
  const selectedFlowId = evaluateExclusiveSplit(
    element.id,
    outgoing,
    element.defaultFlow,
    (expr) => evaluateExpression(expr, scope, ctx.expressionEvaluator),
  )

  const completedToken: Token = { ...token, status: 'completed', updatedAt: ctx.now() }
  ctx.updateToken(completedToken)

  moveTokenToFlow(ctx, token, selectedFlowId, definition)
}

function handleParallelGateway(
  ctx: ExecutionContext,
  token: Token,
  element: GatewayElement,
  definition: ProcessDefinition,
): void {
  const outgoing = getOutgoingFlows(definition, element.id)
  const incoming = getIncomingFlows(definition, element.id)

  const isSplit = outgoing.length > 1
  const isJoin = incoming.length > 1

  if (isJoin) {
    // Check or create join state
    const arrivingFlowId = token.arrivedViaFlowId ?? incoming[0]!.id
    const existingState = ctx.getJoinState(element.id) as ParallelGatewayJoinState | undefined

    const currentJoinState: ParallelGatewayJoinState = existingState ?? {
      gatewayId: element.id,
      instanceId: ctx.instance!.id,
      activationId: ctx.newId(),
      arrivedFromFlows: [],
      expectedFlows: incoming.map(f => f.id),
    }

    const result = evaluateParallelJoin(element.id, arrivingFlowId, currentJoinState)

    // Consume this token regardless
    ctx.updateToken({ ...token, status: 'completed', updatedAt: ctx.now() })

    if (result.fires) {
      ctx.deleteJoinState(element.id)
      // Produce one token on each outgoing flow (usually just one)
      for (const flow of outgoing) {
        moveTokenToFlow(ctx, token, flow.id, definition)
      }
    } else {
      ctx.saveJoinState(result.updatedState)
    }
    return
  }

  // Pure split (or single-flow pass-through)
  const selectedFlowIds = evaluateParallelSplit(element.id, outgoing)
  const completedToken: Token = { ...token, status: 'completed', updatedAt: ctx.now() }
  ctx.updateToken(completedToken)

  for (const flowId of selectedFlowIds) {
    moveTokenToFlow(ctx, token, flowId, definition)
  }
}

function handleInclusiveGateway(
  ctx: ExecutionContext,
  token: Token,
  element: GatewayElement,
  definition: ProcessDefinition,
): void {
  const outgoing = getOutgoingFlows(definition, element.id)
  const incoming = getIncomingFlows(definition, element.id)

  const isJoin = incoming.length > 1

  if (isJoin) {
    const arrivingFlowId = token.arrivedViaFlowId ?? incoming[0]!.id
    const existingState = ctx.getJoinState(element.id) as InclusiveGatewayJoinState | undefined

    if (existingState === undefined) {
      throw new RuntimeError(
        `Inclusive gateway "${element.id}" received a token at the join but has no corresponding split state. Ensure the split recorded activatedIncomingFlows.`,
      )
    }

    const result = evaluateInclusiveJoin(element.id, arrivingFlowId, existingState)

    ctx.updateToken({ ...token, status: 'completed', updatedAt: ctx.now() })

    if (result.fires) {
      ctx.deleteJoinState(element.id)
      for (const flow of outgoing) {
        moveTokenToFlow(ctx, token, flow.id, definition)
      }
    } else {
      ctx.saveJoinState(result.updatedState)
    }
    return
  }

  // Split
  const scope = ctx.resolveScope(token.scopeId)
  const { activatedFlowIds } = evaluateInclusiveSplit(
    element.id,
    outgoing,
    element.defaultFlow,
    (expr) => evaluateExpression(expr, scope, ctx.expressionEvaluator),
  )

  // Record the join state so the corresponding join knows which paths to wait for
  const incomingOfJoin = findInclusiveJoinIncoming(definition, activatedFlowIds)
  if (incomingOfJoin !== null) {
    const joinState: InclusiveGatewayJoinState = {
      gatewayId: incomingOfJoin.joinGatewayId,
      instanceId: ctx.instance!.id,
      activationId: ctx.newId(),
      activatedIncomingFlows: incomingOfJoin.incomingFlows,
      arrivedFromFlows: [],
    }
    ctx.saveJoinState(joinState)
  }

  const completedToken: Token = { ...token, status: 'completed', updatedAt: ctx.now() }
  ctx.updateToken(completedToken)

  for (const flowId of activatedFlowIds) {
    moveTokenToFlow(ctx, token, flowId, definition)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function advanceToken(
  ctx: ExecutionContext,
  token: Token,
  element: BpmnFlowElement,
  definition: ProcessDefinition,
): void {
  const completedToken: Token = { ...token, status: 'completed', updatedAt: ctx.now() }
  ctx.updateToken(completedToken)

  for (const flowId of element.outgoingFlows) {
    moveTokenToFlow(ctx, token, flowId, definition)
  }
}

function moveTokenToFlow(
  ctx: ExecutionContext,
  fromToken: Token,
  flowId: string,
  definition: ProcessDefinition,
): void {
  const flow = getFlow(definition, flowId)
  const targetElement = getElement(definition, flow.targetRef)
  const newToken = ctx.createToken(
    fromToken.instanceId,
    targetElement.id,
    targetElement.type,
    fromToken.scopeId,
    flowId,
  )
  ctx.emit({
    type: 'TokenMoved',
    instanceId: fromToken.instanceId,
    tokenId: newToken.id,
    fromElementId: fromToken.elementId,
    toElementId: targetElement.id,
    toElementType: targetElement.type,
  })
  ctx.enqueuePending(newToken)
}

function suspendToken(ctx: ExecutionContext, token: Token, waitType: Token['waitingFor'] extends { type: infer T } ? T : never): void {
  const waiting: Token = {
    ...token,
    status: 'waiting',
    waitingFor: { type: waitType },
    updatedAt: ctx.now(),
  }
  ctx.updateToken(waiting)
  ctx.emit({
    type: 'TokenWaiting',
    instanceId: token.instanceId,
    tokenId: token.id,
    elementId: token.elementId,
    waitingFor: { type: waitType },
  })
}

function completeInstance(ctx: ExecutionContext): void {
  const startedAt = ctx.instance!.startedAt
  const now = ctx.now()
  ctx.instance = { ...ctx.instance!, status: 'completed', completedAt: now }
  ctx.emit({
    type: 'ProcessInstanceCompleted',
    instanceId: ctx.instance.id,
    durationMs: now.getTime() - startedAt.getTime(),
  })
}

function evaluateExpression(
  expression: string,
  scope: Record<string, VariableValue>,
  evaluator: ExpressionEvaluator,
): boolean {
  return Boolean(evaluator.evaluate(expression, { variables: scope }))
}

/**
 * Looks ahead in the definition to find which incoming flows of an inclusive join
 * will be activated by the given flow IDs. Used to pre-register the join state at split time.
 */
function findInclusiveJoinIncoming(
  definition: ProcessDefinition,
  activatedFlowIds: string[],
): { joinGatewayId: string; incomingFlows: string[] } | null {
  // Find the target elements of the activated flows
  const targets = new Set(
    activatedFlowIds
      .map(fid => definition.sequenceFlows.find(f => f.id === fid)?.targetRef)
      .filter((t): t is string => t !== undefined),
  )

  // Follow flows forward from each target until we find a common inclusive join gateway
  // Simple approach: look for an inclusive gateway downstream that has multiple incoming flows
  // whose sources are all reachable from the activated paths
  for (const element of definition.elements) {
    if (element.type !== 'inclusiveGateway') continue
    const incoming = getIncomingFlows(definition, element.id)
    if (incoming.length <= 1) continue

    // Check if all activated paths lead to this gateway's incoming flows
    const gatewayIncomingIds = new Set(incoming.map(f => f.id))
    const activatedTerminate = activatedFlowIds.filter(fid => {
      const flow = definition.sequenceFlows.find(f => f.id === fid)
      return flow && gatewayIncomingIds.has(fid)
    })

    if (activatedTerminate.length > 0) {
      return {
        joinGatewayId: element.id,
        incomingFlows: activatedFlowIds.filter(fid => gatewayIncomingIds.has(fid)),
      }
    }
  }

  return null
}

// ─── Definition traversal ────────────────────────────────────────────────────

function getElement(definition: ProcessDefinition, id: string): BpmnFlowElement {
  const element = definition.elements.find(e => e.id === id)
  if (!element) {
    throw new DefinitionError(`Element "${id}" not found in definition "${definition.id}"`)
  }
  return element
}

function getFlow(definition: ProcessDefinition, id: string): SequenceFlow {
  const flow = definition.sequenceFlows.find(f => f.id === id)
  if (!flow) {
    throw new DefinitionError(`Sequence flow "${id}" not found in definition "${definition.id}"`)
  }
  return flow
}

function getOutgoingFlows(definition: ProcessDefinition, elementId: string): SequenceFlow[] {
  return definition.sequenceFlows.filter(f => f.sourceRef === elementId)
}

function getIncomingFlows(definition: ProcessDefinition, elementId: string): SequenceFlow[] {
  return definition.sequenceFlows.filter(f => f.targetRef === elementId)
}

// ─── Execution context ────────────────────────────────────────────────────────

class ExecutionContext {
  instance: ProcessInstance | null = null

  private tokenMap: Map<string, Token>
  private scopeMap: Map<string, VariableScope>
  private joinStateMap: Map<string, GatewayJoinState>
  private readonly _events: ExecutionEvent[] = []
  private pendingQueue: Token[] = []
  private readonly _generateId: () => string
  private readonly _now: () => Date
  readonly expressionEvaluator: ExpressionEvaluator

  constructor(state: EngineState | null, options: ExecuteOptions) {
    this._generateId = options.generateId ?? (() => crypto.randomUUID())
    this._now = options.now ?? (() => new Date())
    this.expressionEvaluator = options.expressionEvaluator ?? defaultEvaluator

    if (state !== null) {
      this.instance = state.instance
      this.tokenMap = new Map(state.tokens.map(t => [t.id, { ...t }]))
      this.scopeMap = new Map(state.scopes.map(s => [s.id, { ...s }]))
      this.joinStateMap = new Map(
        state.gatewayJoinStates.map(js => [`${js.gatewayId}`, { ...js }]),
      )
    } else {
      this.tokenMap = new Map()
      this.scopeMap = new Map()
      this.joinStateMap = new Map()
    }
  }

  now(): Date { return this._now() }
  newId(): string { return this._generateId() }

  emit(event: ExecutionEvent): void { this._events.push(event) }

  // ── Tokens ─────────────────────────────────────────────────────────────────

  createToken(
    instanceId: string,
    elementId: string,
    elementType: BpmnElementType,
    scopeId: string,
    arrivedViaFlowId?: string,
  ): Token {
    const token: Token = {
      id: this.newId(),
      instanceId,
      elementId,
      elementType,
      status: 'active',
      scopeId,
      ...(arrivedViaFlowId !== undefined ? { arrivedViaFlowId } : {}),
      createdAt: this.now(),
      updatedAt: this.now(),
    }
    this.tokenMap.set(token.id, token)
    return token
  }

  updateToken(token: Token): void { this.tokenMap.set(token.id, token) }

  requireToken(id: string): Token {
    const token = this.tokenMap.get(id)
    if (!token) throw new RuntimeError(`Token "${id}" not found`)
    return token
  }

  getAllTokens(): Token[] { return [...this.tokenMap.values()] }

  enqueuePending(token: Token): void { this.pendingQueue.push(token) }
  dequeuePending(): Token | undefined { return this.pendingQueue.shift() }
  pendingCount(): number { return this.pendingQueue.length }

  // ── Scopes ─────────────────────────────────────────────────────────────────

  saveScope(scope: VariableScope): void { this.scopeMap.set(scope.id, scope) }

  resolveScope(scopeId: string): Record<string, VariableValue> {
    const result: Record<string, VariableValue> = {}
    let current = this.scopeMap.get(scopeId)
    const chain: VariableScope[] = []
    while (current) {
      chain.unshift(current)
      current = current.parentScopeId ? this.scopeMap.get(current.parentScopeId) : undefined
    }
    for (const scope of chain) {
      Object.assign(result, scope.variables)
    }
    return result
  }

  mergeVariables(scopeId: string, vars: Record<string, VariableValue>): void {
    const scope = this.scopeMap.get(scopeId)
    if (!scope) throw new RuntimeError(`Scope "${scopeId}" not found`)
    this.scopeMap.set(scopeId, { ...scope, variables: { ...scope.variables, ...vars } })
  }

  // ── Gateway join states ─────────────────────────────────────────────────────

  getJoinState(gatewayId: string): GatewayJoinState | undefined {
    return this.joinStateMap.get(gatewayId)
  }

  saveJoinState(state: GatewayJoinState): void {
    this.joinStateMap.set(state.gatewayId, state)
  }

  deleteJoinState(gatewayId: string): void {
    this.joinStateMap.delete(gatewayId)
  }

  // ── Result ─────────────────────────────────────────────────────────────────

  toResult(): EngineResult {
    return {
      newState: {
        instance: this.instance!,
        tokens: [...this.tokenMap.values()],
        scopes: [...this.scopeMap.values()],
        gatewayJoinStates: [...this.joinStateMap.values()],
      },
      events: [...this._events],
    }
  }
}
