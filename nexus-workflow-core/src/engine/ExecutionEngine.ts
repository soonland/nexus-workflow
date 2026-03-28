import { DefinitionError, RuntimeError } from '../model/errors.js'
import { evaluateExclusiveSplit } from '../gateways/ExclusiveGateway.js'
import { evaluateParallelSplit, evaluateParallelJoin } from '../gateways/ParallelGateway.js'
import { evaluateInclusiveSplit, evaluateInclusiveJoin } from '../gateways/InclusiveGateway.js'
import { validateEventBasedGateway } from '../gateways/EventBasedGateway.js'
import { JsEvaluator } from '../expression/JsEvaluator.js'
import type { ExpressionEvaluator } from '../interfaces/ExpressionEvaluator.js'
import type {
  ProcessDefinition,
  BpmnFlowElement,
  SequenceFlow,
  Token,
  VariableScope,
  VariableValue,
  WaitCondition,
  WaitConditionType,
  ProcessInstance,
  GatewayJoinState,
  ParallelGatewayJoinState,
  InclusiveGatewayJoinState,
  BpmnElementType,
  GatewayElement,
  ServiceTaskElement,
  UserTaskElement,
  ScriptTaskElement,
  ManualTaskElement,
  EndEventElement,
  IntermediateCatchEventElement,
  IntermediateThrowEventElement,
  BoundaryEventElement,
  MultiInstanceLoopCharacteristics,
  CompensationRecord,
} from '../model/types.js'
import type { ExecutionEvent } from '../interfaces/EventBus.js'

// ─── Public API types ─────────────────────────────────────────────────────────

export interface EngineState {
  instance: ProcessInstance
  tokens: Token[]
  scopes: VariableScope[]
  gatewayJoinStates: GatewayJoinState[]
  compensationRecords: CompensationRecord[]
}

export type EngineCommand =
  | { type: 'StartProcess'; variables?: Record<string, VariableValue>; correlationKey?: string; businessKey?: string }
  | { type: 'CompleteServiceTask'; tokenId: string; outputVariables?: Record<string, VariableValue> }
  | { type: 'FailServiceTask'; tokenId: string; error: { code: string; message: string } }
  | { type: 'CompleteUserTask'; tokenId: string; completedBy: string; outputVariables?: Record<string, VariableValue> }
  | { type: 'FireTimer'; tokenId: string }
  | { type: 'DeliverMessage'; messageName: string; variables?: Record<string, VariableValue> }
  | { type: 'BroadcastSignal'; signalName: string; variables?: Record<string, VariableValue> }
  | { type: 'SuspendInstance' }
  | { type: 'ResumeInstance' }
  | { type: 'CancelInstance' }

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
      handleFailServiceTask(ctx, command, definition)
      break
    case 'CompleteUserTask':
      handleCompleteTask(ctx, command.tokenId, command.outputVariables, definition)
      break
    case 'FireTimer':
      handleFireTimer(ctx, command.tokenId, definition)
      break
    case 'DeliverMessage':
      handleDeliverMessage(ctx, command, definition)
      break
    case 'BroadcastSignal':
      handleBroadcastSignal(ctx, command, definition)
      break
    case 'SuspendInstance':
      handleSuspendInstance(ctx)
      break
    case 'ResumeInstance':
      handleResumeInstance(ctx)
      break
    case 'CancelInstance':
      handleCancelInstance(ctx)
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

  // Auto-resume a suspended instance when an admin completes a task
  if (ctx.requireInstance().status === 'suspended') {
    ctx.instance = { ...ctx.requireInstance(), status: 'active' }
    ctx.emit({ type: 'ProcessInstanceResumed', instanceId: ctx.instance.id })
  }

  // Merge output variables into the token's scope
  if (outputVariables && Object.keys(outputVariables).length > 0) {
    ctx.mergeVariables(token.scopeId, outputVariables)
  }

  const element = getElement(definition, token.elementId)

  // Check if this is a multi-instance child token completing
  if (token.parentTokenId) {
    const parentToken = ctx.getAllTokens().find(t => t.id === token.parentTokenId)
    const lc = getLoopCharacteristics(element)
    if (parentToken && parentToken.elementId === token.elementId && lc) {
      // Only emit ServiceTaskCompleted for service task children; other types use their own events
      if (element.type === 'serviceTask') {
        ctx.emit({ type: 'ServiceTaskCompleted', instanceId: ctx.requireInstance().id, tokenId, elementId: token.elementId, durationMs: 0 })
      }
      handleMultiInstanceChildCompletion(ctx, token, element, lc, definition)
      runLoop(ctx, definition)
      return
    }

    // Check if this is a compensation handler completing
    if (
      parentToken &&
      parentToken.elementType === 'intermediateThrowEvent' &&
      (element as { isForCompensation?: boolean }).isForCompensation === true
    ) {
      handleCompensationHandlerCompletion(ctx, token, parentToken, element, definition)
      runLoop(ctx, definition)
      return
    }
  }

  ctx.emit({ type: 'ServiceTaskCompleted', instanceId: ctx.requireInstance().id, tokenId, elementId: token.elementId, durationMs: 0 })

  // Cancel any waiting boundary tokens attached to this task
  cancelBoundaryTokensFor(ctx, token.elementId)

  // Record compensation if a compensation boundary event is attached to this task
  recordCompensationIfNeeded(ctx, token, element, definition)

  // Advance through outgoing flows
  advanceToken(ctx, token, element, definition)
  runLoop(ctx, definition)
}

function handleFailServiceTask(
  ctx: ExecutionContext,
  command: Extract<EngineCommand, { type: 'FailServiceTask' }>,
  definition: ProcessDefinition,
): void {
  const token = ctx.requireToken(command.tokenId)
  if (token.status !== 'waiting') {
    throw new RuntimeError(
      `Cannot fail token "${command.tokenId}" — status is "${token.status}", expected "waiting"`,
    )
  }

  ctx.emit({
    type: 'ServiceTaskFailed',
    instanceId: ctx.requireInstance().id,
    tokenId: token.id,
    elementId: token.elementId,
    error: command.error.message,
    attempt: 1,
  })

  // Check for a matching error boundary event on this task
  const errorBoundary = findMatchingErrorBoundary(definition, token.elementId, command.error.code)

  if (errorBoundary) {
    // Cancel the task token and any sibling boundary tokens
    ctx.updateToken({ ...token, status: 'cancelled', updatedAt: ctx.now() })
    ctx.emit({ type: 'TokenCancelled', instanceId: token.instanceId, tokenId: token.id, elementId: token.elementId })
    cancelHostTaskAndBoundaries(ctx, token.elementId, '')

    ctx.emit({
      type: 'ErrorThrown',
      instanceId: ctx.requireInstance().id,
      tokenId: token.id,
      errorCode: command.error.code,
      caught: true,
    })
    ctx.emit({
      type: 'BoundaryEventTriggered',
      instanceId: ctx.requireInstance().id,
      tokenId: token.id,
      boundaryEventId: errorBoundary.id,
      interrupting: errorBoundary.cancelActivity,
    })

    // Route through boundary outgoing flows and continue
    for (const flowId of errorBoundary.outgoingFlows) {
      moveTokenToFlow(ctx, token, flowId, definition)
    }
    runLoop(ctx, definition)
  } else {
    // No matching boundary — suspend the instance, keep token waiting for admin action
    ctx.instance = {
      ...ctx.requireInstance(),
      status: 'suspended',
      errorInfo: {
        code: command.error.code,
        message: command.error.message,
        tokenId: token.id,
        elementId: token.elementId,
      },
    }
    ctx.emit({
      type: 'ProcessInstanceSuspended',
      instanceId: ctx.instance.id,
    })
    ctx.emit({
      type: 'ErrorThrown',
      instanceId: ctx.instance.id,
      tokenId: token.id,
      errorCode: command.error.code,
      caught: false,
    })
  }
}

function handleSuspendInstance(ctx: ExecutionContext): void {
  const status = ctx.requireInstance().status
  if (status !== 'active') {
    throw new RuntimeError(
      `Cannot suspend instance — status is "${status}", expected "active"`,
      ctx.instance?.id,
    )
  }
  ctx.instance = { ...ctx.requireInstance(), status: 'suspended' }
  ctx.emit({ type: 'ProcessInstanceSuspended', instanceId: ctx.instance.id })
}

function handleResumeInstance(ctx: ExecutionContext): void {
  const status = ctx.requireInstance().status
  if (status !== 'suspended') {
    throw new RuntimeError(
      `Cannot resume instance — status is "${status}", expected "suspended"`,
      ctx.instance?.id,
    )
  }
  ctx.instance = { ...ctx.requireInstance(), status: 'active' }
  ctx.emit({ type: 'ProcessInstanceResumed', instanceId: ctx.instance.id })
}

function handleCancelInstance(ctx: ExecutionContext): void {
  const now = ctx.now()
  for (const t of ctx.getAllTokens()) {
    if (t.status === 'active' || t.status === 'waiting') {
      ctx.updateToken({ ...t, status: 'cancelled', updatedAt: now })
      ctx.emit({ type: 'TokenCancelled', instanceId: t.instanceId, tokenId: t.id, elementId: t.elementId })
    }
  }
  ctx.instance = { ...ctx.requireInstance(), status: 'terminated' }
  ctx.emit({ type: 'ProcessInstanceTerminated', instanceId: ctx.instance.id, reason: 'cancelled by admin' })
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
      handleServiceTask(ctx, token, element as ServiceTaskElement, definition)
      break
    case 'userTask':
      handleUserTask(ctx, token, element as UserTaskElement, definition)
      break
    case 'scriptTask': {
      const scriptElement = element as ScriptTaskElement
      if (scriptElement.loopCharacteristics && !token.parentTokenId) {
        handleMultiInstanceStart(ctx, token, scriptElement, scriptElement.loopCharacteristics, definition)
      } else {
        // Script tasks are synchronous — treat like service tasks for now
        suspendToken(ctx, token, 'external')
      }
      break
    }
    case 'manualTask': {
      const manualElement = element as ManualTaskElement
      if (manualElement.loopCharacteristics && !token.parentTokenId) {
        handleMultiInstanceStart(ctx, token, manualElement, manualElement.loopCharacteristics, definition)
      } else if (token.parentTokenId) {
        // MI child: auto-completes immediately; route through aggregation
        const lc = getLoopCharacteristics(element)
        if (lc) handleMultiInstanceChildCompletion(ctx, token, element, lc, definition)
        else advanceToken(ctx, token, element, definition)
      } else {
        // Manual tasks auto-complete
        advanceToken(ctx, token, element, definition)
      }
      break
    }
    case 'intermediateCatchEvent':
      handleIntermediateCatchEvent(ctx, token, element as IntermediateCatchEventElement)
      break
    case 'intermediateThrowEvent':
      handleIntermediateThrowEvent(ctx, token, element as IntermediateThrowEventElement, definition)
      break
    case 'boundaryEvent':
      handleBoundaryEventWait(ctx, token, element as BoundaryEventElement, definition)
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
    case 'eventBasedGateway':
      handleEventBasedGateway(ctx, token, element as GatewayElement, definition)
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
  _definition: ProcessDefinition,
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

function handleServiceTask(
  ctx: ExecutionContext,
  token: Token,
  element: ServiceTaskElement,
  definition: ProcessDefinition,
): void {
  if (element.loopCharacteristics && !token.parentTokenId) {
    handleMultiInstanceStart(ctx, token, element, element.loopCharacteristics, definition)
    return
  }
  ctx.emit({
    type: 'ServiceTaskStarted',
    instanceId: ctx.requireInstance().id,
    tokenId: token.id,
    elementId: element.id,
    taskType: element.taskType ?? 'unknown',
  })
  suspendToken(ctx, token, 'external')
  spawnBoundaryTokens(ctx, token, element.id, definition)
}

function handleUserTask(
  ctx: ExecutionContext,
  token: Token,
  element: UserTaskElement,
  definition: ProcessDefinition,
): void {
  if (element.loopCharacteristics && !token.parentTokenId) {
    handleMultiInstanceStart(ctx, token, element, element.loopCharacteristics, definition)
    return
  }
  suspendToken(ctx, token, 'user-task')
  spawnBoundaryTokens(ctx, token, element.id, definition)
}

function handleIntermediateCatchEvent(
  ctx: ExecutionContext,
  token: Token,
  element: IntermediateCatchEventElement,
): void {
  const { type } = element.eventDefinition
  if (type === 'timer') {
    suspendTokenWithCondition(ctx, token, { type: 'timer' })
  } else if (type === 'message') {
    const messageName = element.eventDefinition.messageName ?? ''
    suspendTokenWithCondition(ctx, token, { type: 'message', correlationData: { messageName } })
  } else if (type === 'signal') {
    const signalName = element.eventDefinition.signalName ?? ''
    suspendTokenWithCondition(ctx, token, { type: 'signal', correlationData: { signalName } })
  } else {
    throw new RuntimeError(`Unsupported intermediateCatchEvent definition type: "${type}"`)
  }
}

function handleIntermediateThrowEvent(
  ctx: ExecutionContext,
  token: Token,
  element: IntermediateThrowEventElement,
  definition: ProcessDefinition,
): void {
  if (element.eventDefinition.type === 'compensation') {
    handleCompensationThrow(ctx, token, element, definition)
  } else {
    // All other intermediate throw events are pass-through
    advanceToken(ctx, token, element, definition)
  }
}

function handleCompensationThrow(
  ctx: ExecutionContext,
  token: Token,
  element: IntermediateThrowEventElement,
  definition: ProcessDefinition,
): void {
  const instanceId = ctx.requireInstance().id
  const { compensationActivityRef } = element.eventDefinition

  // Find records to compensate: targeted or all, in reverse completion order
  let records: CompensationRecord[]
  if (compensationActivityRef) {
    records = ctx.consumeCompensationRecords(compensationActivityRef)
  } else {
    records = ctx.consumeAllCompensationRecords()
  }

  if (records.length === 0) {
    // No handlers to run — pass straight through
    ctx.emit({
      type: 'CompensationTriggered',
      instanceId,
      tokenId: token.id,
      elementId: element.id,
      ...(compensationActivityRef ? { targetActivityId: compensationActivityRef } : {}),
      handlersStarted: [],
    })
    advanceToken(ctx, token, element, definition)
    return
  }

  // Suspend throw token while handlers run
  suspendToken(ctx, token, 'external')

  const handlerIds: string[] = []

  // Spawn handler tokens in reverse completion order (last completed → first compensated)
  for (const record of records) {
    const handlerElement = definition.elements.find(e => e.id === record.handlerId)
    if (!handlerElement) continue

    handlerIds.push(record.handlerId)
    const handlerToken = ctx.createToken(instanceId, record.handlerId, handlerElement.type, token.scopeId)
    const tagged: Token = { ...handlerToken, parentTokenId: token.id }
    ctx.updateToken(tagged)
    ctx.emit({
      type: 'TokenMoved',
      instanceId,
      tokenId: tagged.id,
      fromElementId: element.id,
      toElementId: record.handlerId,
      toElementType: handlerElement.type,
    })
    ctx.enqueuePending(tagged)
  }

  ctx.emit({
    type: 'CompensationTriggered',
    instanceId,
    tokenId: token.id,
    elementId: element.id,
    ...(compensationActivityRef ? { targetActivityId: compensationActivityRef } : {}),
    handlersStarted: handlerIds,
  })
}

function handleBoundaryEventWait(
  ctx: ExecutionContext,
  token: Token,
  element: BoundaryEventElement,
  _definition: ProcessDefinition,
): void {
  const { type } = element.eventDefinition
  const base = { hostTaskId: element.attachedToRef }
  if (type === 'timer') {
    suspendTokenWithCondition(ctx, token, { type: 'timer', correlationData: base })
  } else if (type === 'message') {
    const messageName = element.eventDefinition.messageName ?? ''
    suspendTokenWithCondition(ctx, token, { type: 'message', correlationData: { ...base, messageName } })
  } else if (type === 'signal') {
    const signalName = element.eventDefinition.signalName ?? ''
    suspendTokenWithCondition(ctx, token, { type: 'signal', correlationData: { ...base, signalName } })
  } else if (type === 'error') {
    // Error boundary tokens wait passively — they fire via FailServiceTask, not via a command
    suspendTokenWithCondition(ctx, token, { type: 'external', correlationData: base })
  } else {
    throw new RuntimeError(`Unsupported boundaryEvent definition type: "${type}"`)
  }
}

function handleFireTimer(
  ctx: ExecutionContext,
  tokenId: string,
  definition: ProcessDefinition,
): void {
  const token = ctx.requireToken(tokenId)
  if (token.status !== 'waiting') {
    throw new RuntimeError(
      `Cannot fire timer for token "${tokenId}" — status is "${token.status}", expected "waiting"`,
      ctx.instance?.id,
    )
  }

  if (token.elementType === 'boundaryEvent') {
    const element = getElement(definition, token.elementId) as BoundaryEventElement
    // Complete the boundary token
    ctx.updateToken({ ...token, status: 'completed', updatedAt: ctx.now() })
    // Cancel host task token if this is an interrupting boundary
    if (element.cancelActivity) {
      cancelHostTaskAndBoundaries(ctx, element.attachedToRef, tokenId)
    }
    // Route through boundary outgoing flows
    for (const flowId of element.outgoingFlows) {
      moveTokenToFlow(ctx, token, flowId, definition)
    }
    runLoop(ctx, definition)
  } else {
    // Cancel EBG sibling branches before advancing (no-op if not an EBG branch)
    cancelEbgSiblings(ctx, token)
    // Intermediate timer catch event — advance normally
    handleCompleteTask(ctx, tokenId, undefined, definition)
  }
}

function handleDeliverMessage(
  ctx: ExecutionContext,
  command: Extract<EngineCommand, { type: 'DeliverMessage' }>,
  definition: ProcessDefinition,
): void {
  const targets = ctx.getAllTokens().filter(
    t => t.status === 'waiting' &&
      t.waitingFor?.type === 'message' &&
      t.waitingFor.correlationData?.['messageName'] === command.messageName,
  )

  for (const token of targets) {
    // Re-check: EBG sibling cancellation mid-loop may have already cancelled this token
    if (ctx.requireToken(token.id).status !== 'waiting') continue
    if (command.variables && Object.keys(command.variables).length > 0) {
      ctx.mergeVariables(token.scopeId, command.variables)
    }
    ctx.updateToken({ ...token, status: 'completed', updatedAt: ctx.now() })
    cancelEbgSiblings(ctx, token)
    advanceTokenFlows(ctx, token, definition)
  }

  runLoop(ctx, definition)
}

function handleBroadcastSignal(
  ctx: ExecutionContext,
  command: Extract<EngineCommand, { type: 'BroadcastSignal' }>,
  definition: ProcessDefinition,
): void {
  const targets = ctx.getAllTokens().filter(
    t => t.status === 'waiting' &&
      t.waitingFor?.type === 'signal' &&
      t.waitingFor.correlationData?.['signalName'] === command.signalName,
  )

  for (const token of targets) {
    // Re-check: EBG sibling cancellation mid-loop may have already cancelled this token
    if (ctx.requireToken(token.id).status !== 'waiting') continue
    if (command.variables && Object.keys(command.variables).length > 0) {
      ctx.mergeVariables(token.scopeId, command.variables)
    }
    ctx.updateToken({ ...token, status: 'completed', updatedAt: ctx.now() })
    cancelEbgSiblings(ctx, token)
    advanceTokenFlows(ctx, token, definition)
  }

  runLoop(ctx, definition)
}

/** Spawn waiting tokens for all boundary events attached to the given task element.
 *  Compensation boundary events are passive — they are NOT spawned; they register via CompensationRecord. */
function spawnBoundaryTokens(
  ctx: ExecutionContext,
  hostToken: Token,
  taskElementId: string,
  definition: ProcessDefinition,
): void {
  const boundaries = definition.elements.filter(
    (e): e is BoundaryEventElement =>
      e.type === 'boundaryEvent' &&
      (e as BoundaryEventElement).attachedToRef === taskElementId &&
      (e as BoundaryEventElement).eventDefinition.type !== 'compensation',
  )
  for (const boundary of boundaries) {
    const bToken = ctx.createToken(hostToken.instanceId, boundary.id, 'boundaryEvent', hostToken.scopeId)
    ctx.enqueuePending(bToken)
  }
}

/**
 * Find the best matching error boundary on a task for a given error code.
 * Prefers exact errorCode match; falls back to catch-all (no errorCode).
 */
function findMatchingErrorBoundary(
  definition: ProcessDefinition,
  taskElementId: string,
  errorCode: string,
): BoundaryEventElement | null {
  const boundaries = definition.elements.filter(
    (e): e is BoundaryEventElement =>
      e.type === 'boundaryEvent' &&
      (e as BoundaryEventElement).attachedToRef === taskElementId &&
      (e as BoundaryEventElement).eventDefinition.type === 'error',
  )
  const exact = boundaries.find(b => b.eventDefinition.errorCode === errorCode)
  if (exact) return exact
  const catchAll = boundaries.find(b => !b.eventDefinition.errorCode)
  return catchAll ?? null
}

/** Cancel any waiting boundary tokens whose host task just completed normally. */
function cancelBoundaryTokensFor(ctx: ExecutionContext, taskElementId: string): void {
  const now = ctx.now()
  for (const t of ctx.getAllTokens()) {
    if (t.status !== 'waiting' || t.elementType !== 'boundaryEvent') continue
    // A boundary token is attached to taskElementId if its element's attachedToRef matches.
    // We track this by checking elementType (boundary tokens always sit at a boundaryEvent element)
    // and cross-referencing via the stored elementId — but we don't have the definition here.
    // Instead we tag boundary tokens with the host task id in correlationData.
    if (t.waitingFor?.correlationData?.['hostTaskId'] === taskElementId) {
      ctx.updateToken({ ...t, status: 'cancelled', updatedAt: now })
      ctx.emit({ type: 'TokenCancelled', instanceId: t.instanceId, tokenId: t.id, elementId: t.elementId })
    }
  }
}

/** Cancel the host task token and any sibling boundary tokens (except the one that fired). */
function cancelHostTaskAndBoundaries(
  ctx: ExecutionContext,
  attachedToRef: string,
  firingBoundaryTokenId: string,
): void {
  const now = ctx.now()
  for (const t of ctx.getAllTokens()) {
    if (t.id === firingBoundaryTokenId) continue
    if (t.status !== 'waiting') continue
    const isHostTask = t.elementId === attachedToRef
    const isSiblingBoundary = t.waitingFor?.correlationData?.['hostTaskId'] === attachedToRef
    if (isHostTask || isSiblingBoundary) {
      ctx.updateToken({ ...t, status: 'cancelled', updatedAt: now })
      ctx.emit({ type: 'TokenCancelled', instanceId: t.instanceId, tokenId: t.id, elementId: t.elementId })
    }
  }
}

function handleExclusiveGateway(
  ctx: ExecutionContext,
  token: Token,
  element: GatewayElement,
  definition: ProcessDefinition,
): void {
  const outgoing = getOutgoingFlows(definition, element.id)

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

  const isJoin = incoming.length > 1

  if (isJoin) {
    // Check or create join state
    const firstIncoming = incoming[0]
    if (!firstIncoming) throw new RuntimeError(`Parallel gateway "${element.id}" has no incoming flows`)
    const arrivingFlowId = token.arrivedViaFlowId ?? firstIncoming.id
    const existingState = ctx.getJoinState(element.id) as ParallelGatewayJoinState | undefined

    const currentJoinState: ParallelGatewayJoinState = existingState ?? {
      gatewayId: element.id,
      instanceId: ctx.requireInstance().id,
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
    const firstIncoming = incoming[0]
    if (!firstIncoming) throw new RuntimeError(`Inclusive gateway "${element.id}" has no incoming flows`)
    const arrivingFlowId = token.arrivedViaFlowId ?? firstIncoming.id
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
      instanceId: ctx.requireInstance().id,
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

function handleEventBasedGateway(
  ctx: ExecutionContext,
  token: Token,
  element: GatewayElement,
  definition: ProcessDefinition,
): void {
  validateEventBasedGateway(element, definition)

  const outgoing = getOutgoingFlows(definition, element.id)

  // Consume the EBG token
  ctx.updateToken({ ...token, status: 'completed', updatedAt: ctx.now() })

  const branchElementIds: string[] = []

  // Spawn one child token per outgoing flow, placed directly at the target ICE
  for (const flow of outgoing) {
    const targetElement = getElement(definition, flow.targetRef)
    branchElementIds.push(targetElement.id)

    const baseToken = ctx.createToken(
      token.instanceId,
      targetElement.id,
      targetElement.type,
      token.scopeId,
      flow.id,
    )
    // Set parentTokenId so siblings can be found and cancelled when one branch wins
    const childToken: Token = { ...baseToken, parentTokenId: token.id }
    ctx.updateToken(childToken)
    ctx.emit({
      type: 'TokenMoved',
      instanceId: token.instanceId,
      tokenId: childToken.id,
      fromElementId: token.elementId,
      toElementId: targetElement.id,
      toElementType: targetElement.type,
    })
    ctx.enqueuePending(childToken)
  }

  ctx.emit({
    type: 'EventBasedGatewayActivated',
    instanceId: token.instanceId,
    tokenId: token.id,
    elementId: element.id,
    branches: branchElementIds,
  })
}

/**
 * When an EBG child token wins the race (its event fires), cancel all sibling tokens
 * (tokens sharing the same parentTokenId) that are still waiting.
 * No-op if the token has no parentTokenId (i.e. is not an EBG child).
 */
function cancelEbgSiblings(ctx: ExecutionContext, winnerToken: Token): void {
  if (!winnerToken.parentTokenId) return
  const now = ctx.now()
  for (const t of ctx.getAllTokens()) {
    if (t.id === winnerToken.id) continue
    if (t.parentTokenId !== winnerToken.parentTokenId) continue
    if (t.status !== 'waiting') continue
    ctx.updateToken({ ...t, status: 'cancelled', updatedAt: now })
    ctx.emit({ type: 'TokenCancelled', instanceId: t.instanceId, tokenId: t.id, elementId: t.elementId })
  }
}

// ─── Compensation ─────────────────────────────────────────────────────────────

/**
 * After a task completes normally, check if a compensation boundary event is attached.
 * If so, record a CompensationRecord for later triggering.
 */
function recordCompensationIfNeeded(
  ctx: ExecutionContext,
  token: Token,
  element: BpmnFlowElement,
  definition: ProcessDefinition,
): void {
  const compBoundary = definition.elements.find(
    (e): e is BoundaryEventElement =>
      e.type === 'boundaryEvent' &&
      (e as BoundaryEventElement).attachedToRef === element.id &&
      (e as BoundaryEventElement).eventDefinition.type === 'compensation',
  ) as BoundaryEventElement | undefined

  if (!compBoundary) return

  const handlerId = compBoundary.eventDefinition.compensationActivityRef
  if (!handlerId) return

  ctx.addCompensationRecord({
    instanceId: ctx.requireInstance().id,
    activityId: element.id,
    tokenId: token.id,
    handlerId,
    completedAt: ctx.now(),
  })
}

/**
 * Called when a compensation handler task token completes.
 * If all sibling handler tokens for the same throw event are done, resume the throw token.
 */
function handleCompensationHandlerCompletion(
  ctx: ExecutionContext,
  handlerToken: Token,
  throwToken: Token,
  _handlerElement: BpmnFlowElement,
  definition: ProcessDefinition,
): void {
  // Mark handler token completed
  ctx.updateToken({ ...handlerToken, status: 'completed', updatedAt: ctx.now() })

  // Check if all sibling handler tokens are done
  const siblings = ctx.getAllTokens().filter(t => t.parentTokenId === throwToken.id)
  const allDone = siblings.every(t => t.status === 'completed' || t.status === 'cancelled')

  if (!allDone) return

  // All handlers complete — emit CompensationCompleted and advance the throw token
  ctx.emit({
    type: 'CompensationCompleted',
    instanceId: ctx.requireInstance().id,
    tokenId: throwToken.id,
    elementId: throwToken.elementId,
  })

  // Resume the suspended throw token and advance it
  const throwElement = getElement(definition, throwToken.elementId)
  advanceToken(ctx, throwToken, throwElement, definition)
}

// ─── Multi-instance ───────────────────────────────────────────────────────────

type MultiInstanceTaskElement = ServiceTaskElement | UserTaskElement | ScriptTaskElement | ManualTaskElement

function getLoopCharacteristics(element: BpmnFlowElement): MultiInstanceLoopCharacteristics | undefined {
  const el = element as MultiInstanceTaskElement
  return el.loopCharacteristics
}

function handleMultiInstanceStart(
  ctx: ExecutionContext,
  token: Token,
  element: MultiInstanceTaskElement,
  lc: MultiInstanceLoopCharacteristics,
  definition: ProcessDefinition,
): void {
  const scope = ctx.resolveScope(token.scopeId)
  const rawCollection = ctx.expressionEvaluator.evaluate(lc.inputCollection, { variables: scope })

  if (!Array.isArray(rawCollection)) {
    throw new RuntimeError(
      `Multi-instance inputCollection "${lc.inputCollection}" did not resolve to an array`,
      ctx.instance?.id,
    )
  }

  const collection = rawCollection as unknown[]

  // Empty collection — skip task entirely
  if (collection.length === 0) {
    const completed: Token = { ...token, status: 'completed', updatedAt: ctx.now() }
    ctx.updateToken(completed)
    ctx.emit({
      type: 'MultiInstanceCompleted',
      instanceId: ctx.requireInstance().id,
      tokenId: token.id,
      elementId: element.id,
      iterationsRan: 0,
    })
    advanceToken(ctx, token, element, definition)
    return
  }

  // Suspend parent token to wait for children
  const waiting: Token = {
    ...token,
    status: 'waiting',
    waitingFor: { type: 'external' },
    updatedAt: ctx.now(),
  }
  ctx.updateToken(waiting)

  if (lc.isSequential) {
    // Store loop state on the parent token (not in user-visible variable scope)
    ctx.updateToken({ ...waiting, loopState: { collection, index: 0, iterationsRan: 0 } })
    ctx.emit({
      type: 'MultiInstanceStarted',
      instanceId: ctx.requireInstance().id,
      tokenId: token.id,
      elementId: element.id,
      count: collection.length,
      isSequential: true,
    })
    spawnMultiInstanceChild(ctx, token, element, lc, collection[0], definition)
  } else {
    // Parallel: spawn one child per item
    ctx.emit({
      type: 'MultiInstanceStarted',
      instanceId: ctx.requireInstance().id,
      tokenId: token.id,
      elementId: element.id,
      count: collection.length,
      isSequential: false,
    })

    // Initialize outputCollection in parent scope if configured
    if (lc.outputCollection) {
      ctx.mergeVariables(token.scopeId, {
        [lc.outputCollection]: { type: 'array', value: [] },
      })
    }

    for (const item of collection) {
      spawnMultiInstanceChild(ctx, token, element, lc, item, definition)
    }
  }
}

function spawnMultiInstanceChild(
  ctx: ExecutionContext,
  parentToken: Token,
  element: MultiInstanceTaskElement,
  lc: MultiInstanceLoopCharacteristics,
  item: unknown,
  _definition: ProcessDefinition,
): void {
  // Create a child scope with the loop variable
  const childScope: VariableScope = {
    id: ctx.newId(),
    parentScopeId: parentToken.scopeId,
    variables: lc.inputElement
      ? { [lc.inputElement]: { type: 'object', value: item } }
      : {},
  }
  ctx.saveScope(childScope)

  const childToken = ctx.createToken(
    parentToken.instanceId,
    element.id,
    element.type,
    childScope.id,
  )
  // Tag child token with parent
  ctx.updateToken({ ...childToken, parentTokenId: parentToken.id })
  ctx.enqueuePending({ ...childToken, parentTokenId: parentToken.id })
}

function handleMultiInstanceChildCompletion(
  ctx: ExecutionContext,
  childToken: Token,
  element: BpmnFlowElement,
  lc: MultiInstanceLoopCharacteristics,
  definition: ProcessDefinition,
): void {
  const parentToken = ctx.getAllTokens().find(t => t.id === childToken.parentTokenId)
  if (!parentToken) return

  // Mark child as completed
  ctx.updateToken({ ...childToken, status: 'completed', updatedAt: ctx.now() })

  // Collect output into parent scope
  if (lc.outputElement && lc.outputCollection) {
    const childScope = ctx.resolveScope(childToken.scopeId)
    const outputVal = childScope[lc.outputElement]
    if (outputVal !== undefined) {
      const parentScope = ctx.resolveScope(parentToken.scopeId)
      const existing = parentScope[lc.outputCollection]
      const arr = Array.isArray(existing?.value) ? [...(existing.value as unknown[])] : []
      arr.push(outputVal.value)
      ctx.mergeVariables(parentToken.scopeId, {
        [lc.outputCollection]: { type: 'array', value: arr },
      })
    }
  }

  if (lc.isSequential) {
    handleSequentialChildCompletion(ctx, childToken, parentToken, element, lc, definition)
  } else {
    handleParallelChildCompletion(ctx, childToken, parentToken, element, lc, definition)
  }
}

function handleSequentialChildCompletion(
  ctx: ExecutionContext,
  childToken: Token,
  parentToken: Token,
  element: BpmnFlowElement,
  lc: MultiInstanceLoopCharacteristics,
  definition: ProcessDefinition,
): void {
  const loopState = parentToken.loopState
  if (!loopState) return

  const iterationsRan = loopState.iterationsRan + 1

  // Check completion condition — evaluate against child scope chain (includes output vars)
  if (lc.completionCondition) {
    const condScope = ctx.resolveScope(childToken.scopeId)
    const condResult = ctx.expressionEvaluator.evaluate(lc.completionCondition, { variables: condScope })
    if (condResult) {
      completeMultiInstance(ctx, parentToken, element, iterationsRan, definition)
      return
    }
  }

  const nextIndex = loopState.index + 1

  if (nextIndex >= loopState.collection.length) {
    // All items processed
    completeMultiInstance(ctx, parentToken, element, iterationsRan, definition)
    return
  }

  // Update loop state on parent token and spawn next child
  ctx.updateToken({ ...parentToken, loopState: { collection: loopState.collection, index: nextIndex, iterationsRan } })

  const miElement = element as MultiInstanceTaskElement
  spawnMultiInstanceChild(ctx, parentToken, miElement, lc, loopState.collection[nextIndex], definition)
}

function handleParallelChildCompletion(
  ctx: ExecutionContext,
  childToken: Token,
  parentToken: Token,
  element: BpmnFlowElement,
  lc: MultiInstanceLoopCharacteristics,
  definition: ProcessDefinition,
): void {
  // Check completion condition first — evaluate against child scope chain (includes output vars)
  if (lc.completionCondition) {
    const condScope = ctx.resolveScope(childToken.scopeId)
    const condResult = ctx.expressionEvaluator.evaluate(lc.completionCondition, { variables: condScope })
    if (condResult) {
      // Cancel all remaining sibling tokens
      const siblings = ctx.getAllTokens().filter(
        t => t.parentTokenId === parentToken.id && t.status === 'waiting',
      )
      const now = ctx.now()
      for (const sibling of siblings) {
        ctx.updateToken({ ...sibling, status: 'cancelled', updatedAt: now })
        ctx.emit({ type: 'TokenCancelled', instanceId: sibling.instanceId, tokenId: sibling.id, elementId: sibling.elementId })
      }
      // Count completed iterations (already updated child to completed above)
      const iterationsRan = ctx.getAllTokens().filter(
        t => t.parentTokenId === parentToken.id && t.status === 'completed',
      ).length
      completeMultiInstance(ctx, parentToken, element, iterationsRan, definition)
      return
    }
  }

  // Check if all sibling tokens are done
  const siblings = ctx.getAllTokens().filter(t => t.parentTokenId === parentToken.id)
  const allDone = siblings.every(t => t.status === 'completed' || t.status === 'cancelled')

  if (allDone) {
    const iterationsRan = siblings.filter(t => t.status === 'completed').length
    completeMultiInstance(ctx, parentToken, element, iterationsRan, definition)
  }
}

function completeMultiInstance(
  ctx: ExecutionContext,
  parentToken: Token,
  element: BpmnFlowElement,
  iterationsRan: number,
  definition: ProcessDefinition,
): void {
  const completed: Token = { ...parentToken, status: 'completed', updatedAt: ctx.now() }
  ctx.updateToken(completed)

  ctx.emit({
    type: 'MultiInstanceCompleted',
    instanceId: ctx.requireInstance().id,
    tokenId: parentToken.id,
    elementId: element.id,
    iterationsRan,
  })

  // Cancel any waiting boundary tokens attached to this task
  cancelBoundaryTokensFor(ctx, element.id)

  // Advance through outgoing flows
  for (const flowId of element.outgoingFlows) {
    moveTokenToFlow(ctx, parentToken, flowId, definition)
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

function suspendToken(ctx: ExecutionContext, token: Token, waitType: WaitConditionType): void {
  suspendTokenWithCondition(ctx, token, { type: waitType })
}

function suspendTokenWithCondition(ctx: ExecutionContext, token: Token, condition: WaitCondition): void {
  const waiting: Token = {
    ...token,
    status: 'waiting',
    waitingFor: condition,
    updatedAt: ctx.now(),
  }
  ctx.updateToken(waiting)
  ctx.emit({
    type: 'TokenWaiting',
    instanceId: token.instanceId,
    tokenId: token.id,
    elementId: token.elementId,
    waitingFor: condition,
  })
}

/** Enqueue new tokens on every outgoing flow of the given token's element. */
function advanceTokenFlows(ctx: ExecutionContext, token: Token, definition: ProcessDefinition): void {
  const element = getElement(definition, token.elementId)
  for (const flowId of element.outgoingFlows) {
    moveTokenToFlow(ctx, token, flowId, definition)
  }
}

function completeInstance(ctx: ExecutionContext): void {
  const startedAt = ctx.requireInstance().startedAt
  const now = ctx.now()
  ctx.instance = { ...ctx.requireInstance(), status: 'completed', completedAt: now }
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
  // Look for an inclusive gateway downstream that has multiple incoming flows
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
  private compensationList: CompensationRecord[]
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
      this.compensationList = [...(state.compensationRecords ?? [])]
    } else {
      this.tokenMap = new Map()
      this.scopeMap = new Map()
      this.joinStateMap = new Map()
      this.compensationList = []
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

  requireInstance(): ProcessInstance {
    if (!this.instance) throw new RuntimeError('No active process instance in execution context')
    return this.instance
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

  // ── Compensation records ────────────────────────────────────────────────────

  addCompensationRecord(record: CompensationRecord): void {
    this.compensationList.push(record)
  }

  /**
   * Consume and return records for a specific activity, in reverse completion order.
   * Records are removed so they cannot be re-triggered.
   */
  consumeCompensationRecords(activityId: string): CompensationRecord[] {
    const matching = this.compensationList.filter(r => r.activityId === activityId)
    this.compensationList = this.compensationList.filter(r => r.activityId !== activityId)
    return matching.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
  }

  /**
   * Consume and return all records in reverse completion order.
   * Records are removed so they cannot be re-triggered.
   */
  consumeAllCompensationRecords(): CompensationRecord[] {
    const all = [...this.compensationList]
    this.compensationList = []
    return all.sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
  }

  // ── Result ─────────────────────────────────────────────────────────────────

  toResult(): EngineResult {
    return {
      newState: {
        instance: this.requireInstance(),
        tokens: [...this.tokenMap.values()],
        scopes: [...this.scopeMap.values()],
        gatewayJoinStates: [...this.joinStateMap.values()],
        compensationRecords: [...this.compensationList],
      },
      events: [...this._events],
    }
  }
}
