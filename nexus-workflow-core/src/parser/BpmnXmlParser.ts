import { XMLParser } from 'fast-xml-parser'
import { DefinitionError } from '../model/errors.js'
import type {
  ProcessDefinition,
  BpmnFlowElement,
  SequenceFlow,
  StartEventElement,
  EndEventElement,
  IntermediateCatchEventElement,
  IntermediateThrowEventElement,
  BoundaryEventElement,
  ServiceTaskElement,
  UserTaskElement,
  ScriptTaskElement,
  ManualTaskElement,
  CallActivityElement,
  GatewayElement,
  EventDefinition,
} from '../model/types.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ValidationError {
  code: string
  message: string
  elementId?: string
}

export interface ParseResult {
  definition: ProcessDefinition | null
  errors: ValidationError[]
}

// ─── XML Parser config ────────────────────────────────────────────────────────

// Elements that may appear multiple times and must always be arrays
const ARRAY_ELEMENTS = new Set([
  'sequenceFlow',
  'startEvent', 'endEvent',
  'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent',
  'serviceTask', 'userTask', 'scriptTask', 'manualTask', 'callActivity',
  'exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway',
  'subProcess',
  'incoming', 'outgoing',
  'timerEventDefinition', 'messageEventDefinition', 'signalEventDefinition',
  'errorEventDefinition', 'terminateEventDefinition', 'compensateEventDefinition',
  'conditionExpression',
])

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) => ARRAY_ELEMENTS.has(name),
  textNodeName: '#text',
  trimValues: true,
})

// ─── Entry point ──────────────────────────────────────────────────────────────

export function parseBpmn(xml: string): ParseResult {
  let parsed: Record<string, unknown>
  try {
    parsed = xmlParser.parse(xml) as Record<string, unknown>
  } catch (e) {
    throw new DefinitionError(`Failed to parse BPMN XML: ${(e as Error).message}`)
  }

  const definitions = parsed['definitions'] as Record<string, unknown> | undefined
  if (!definitions) {
    throw new DefinitionError('Root <definitions> element not found — is this valid BPMN 2.0 XML?')
  }

  const rawProcess = definitions['process'] as Record<string, unknown> | undefined
  if (!rawProcess) {
    throw new DefinitionError('No <process> element found inside <definitions>')
  }

  const errors: ValidationError[] = []
  const elements: BpmnFlowElement[] = []
  const sequenceFlows: SequenceFlow[] = []

  // ── Sequence flows ────────────────────────────────────────────────────────
  const rawFlows = (rawProcess['sequenceFlow'] ?? []) as Record<string, unknown>[]
  for (const raw of rawFlows) {
    sequenceFlows.push(parseSequenceFlow(raw))
  }

  // Build a quick lookup: flowId → isDefault (set by gateway's default attr)
  const defaultFlowIds = new Set<string>()
  for (const raw of collectGateways(rawProcess)) {
    const def = raw['@_default'] as string | undefined
    if (def) defaultFlowIds.add(def)
  }

  // Mark default flows
  for (const flow of sequenceFlows) {
    if (defaultFlowIds.has(flow.id)) {
      flow.isDefault = true
    }
  }

  // ── Elements ──────────────────────────────────────────────────────────────
  elements.push(...parseElements(rawProcess, sequenceFlows))

  // ── Validation ────────────────────────────────────────────────────────────
  validate(rawProcess, elements, sequenceFlows, errors)

  // ── Assemble definition ───────────────────────────────────────────────────
  const startEvents = elements.filter(e => e.type === 'startEvent')
  const startEventId = startEvents[0]?.id ?? ''

  const processId = String(rawProcess['@_id'] ?? '')
  const definition: ProcessDefinition = {
    id: processId,
    version: 1,
    ...(rawProcess['@_name'] !== undefined ? { name: String(rawProcess['@_name']) } : {}),
    elements,
    sequenceFlows,
    startEventId,
    deployedAt: new Date(),
    isDeployable: errors.length === 0,
  }

  return { definition, errors }
}

// ─── Element parsers ──────────────────────────────────────────────────────────

function parseElements(
  rawProcess: Record<string, unknown>,
  flows: SequenceFlow[],
): BpmnFlowElement[] {
  const elements: BpmnFlowElement[] = []

  const addAll = <T extends BpmnFlowElement>(
    key: string,
    parser: (raw: Record<string, unknown>, flows: SequenceFlow[]) => T,
  ) => {
    const items = (rawProcess[key] ?? []) as Record<string, unknown>[]
    for (const raw of items) elements.push(parser(raw, flows))
  }

  addAll('startEvent',             parseStartEvent)
  addAll('endEvent',               parseEndEvent)
  addAll('intermediateCatchEvent', parseIntermediateCatchEvent)
  addAll('intermediateThrowEvent', parseIntermediateThrowEvent)
  addAll('boundaryEvent',          parseBoundaryEvent)
  addAll('serviceTask',            parseServiceTask)
  addAll('userTask',               parseUserTask)
  addAll('scriptTask',             parseScriptTask)
  addAll('manualTask',             parseManualTask)
  addAll('callActivity',           parseCallActivity)
  addAll('exclusiveGateway',       parseGateway('exclusiveGateway'))
  addAll('parallelGateway',        parseGateway('parallelGateway'))
  addAll('inclusiveGateway',       parseGateway('inclusiveGateway'))
  addAll('eventBasedGateway',      parseGateway('eventBasedGateway'))

  return elements
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function base(raw: Record<string, unknown>, _flows: SequenceFlow[]) {
  const id = String(raw['@_id'] ?? '')
  const incoming = toStringArray(raw['incoming'])
  const outgoing = toStringArray(raw['outgoing'])
  const name = raw['@_name'] !== undefined ? String(raw['@_name']) : undefined
  return { id, incoming, outgoing, name }
}

function baseElement(raw: Record<string, unknown>, flows: SequenceFlow[]) {
  const { id, incoming, outgoing, name } = base(raw, flows)
  return {
    id,
    incomingFlows: incoming,
    outgoingFlows: outgoing,
    ...(name !== undefined ? { name } : {}),
  }
}

// ── Events ────────────────────────────────────────────────────────────────────

function parseStartEvent(raw: Record<string, unknown>, flows: SequenceFlow[]): StartEventElement {
  return {
    ...baseElement(raw, flows),
    type: 'startEvent',
    eventDefinition: parseEventDefinition(raw),
  }
}

function parseEndEvent(raw: Record<string, unknown>, flows: SequenceFlow[]): EndEventElement {
  return {
    ...baseElement(raw, flows),
    type: 'endEvent',
    eventDefinition: parseEventDefinition(raw),
  }
}

function parseIntermediateCatchEvent(
  raw: Record<string, unknown>,
  flows: SequenceFlow[],
): IntermediateCatchEventElement {
  return {
    ...baseElement(raw, flows),
    type: 'intermediateCatchEvent',
    eventDefinition: parseEventDefinition(raw),
  }
}

function parseIntermediateThrowEvent(
  raw: Record<string, unknown>,
  flows: SequenceFlow[],
): IntermediateThrowEventElement {
  return {
    ...baseElement(raw, flows),
    type: 'intermediateThrowEvent',
    eventDefinition: parseEventDefinition(raw),
  }
}

function parseBoundaryEvent(
  raw: Record<string, unknown>,
  flows: SequenceFlow[],
): BoundaryEventElement {
  const cancelActivity = raw['@_cancelActivity'] !== 'false'
  return {
    ...baseElement(raw, flows),
    type: 'boundaryEvent',
    attachedToRef: String(raw['@_attachedToRef'] ?? ''),
    cancelActivity,
    eventDefinition: parseEventDefinition(raw),
  }
}

function parseEventDefinition(raw: Record<string, unknown>): EventDefinition {
  if (hasKey(raw, 'timerEventDefinition')) {
    const timerDef = firstOf(raw['timerEventDefinition']) as Record<string, unknown>
    const duration = extractText(timerDef['timeDuration'])
    const date = extractText(timerDef['timeDate'])
    const cycle = extractText(timerDef['timeCycle'])
    return { type: 'timer', timerExpression: duration ?? date ?? cycle ?? '' }
  }
  if (hasKey(raw, 'messageEventDefinition')) {
    const msgDef = firstOf(raw['messageEventDefinition']) as Record<string, unknown>
    const messageRef = msgDef['@_messageRef'] as string | undefined
    return { type: 'message', messageName: messageRef ?? '' }
  }
  if (hasKey(raw, 'signalEventDefinition')) {
    const sigDef = firstOf(raw['signalEventDefinition']) as Record<string, unknown>
    const signalRef = sigDef['@_signalRef'] as string | undefined
    return { type: 'signal', signalName: signalRef ?? '' }
  }
  if (hasKey(raw, 'errorEventDefinition')) {
    const errDef = firstOf(raw['errorEventDefinition']) as Record<string, unknown>
    const errorRef = errDef['@_errorRef'] as string | undefined
    return { type: 'error', errorCode: errorRef ?? '' }
  }
  if (hasKey(raw, 'terminateEventDefinition')) {
    return { type: 'terminate' }
  }
  return { type: 'none' }
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

function parseServiceTask(
  raw: Record<string, unknown>,
  flows: SequenceFlow[],
): ServiceTaskElement {
  // Support nexus:type, camunda:type, or zeebe:taskDefinition type
  const taskType =
    (raw['@_nexus:type'] as string | undefined) ??
    (raw['@_type'] as string | undefined) ??
    undefined
  return {
    ...baseElement(raw, flows),
    type: 'serviceTask',
    ...(taskType !== undefined ? { taskType } : {}),
  }
}

function parseUserTask(raw: Record<string, unknown>, flows: SequenceFlow[]): UserTaskElement {
  return {
    ...baseElement(raw, flows),
    type: 'userTask',
    priority: 50,
    ...(raw['@_assignee'] !== undefined ? { assignee: String(raw['@_assignee']) } : {}),
    ...(raw['@_formKey'] !== undefined ? { formKey: String(raw['@_formKey']) } : {}),
  }
}

function parseScriptTask(raw: Record<string, unknown>, flows: SequenceFlow[]): ScriptTaskElement {
  return {
    ...baseElement(raw, flows),
    type: 'scriptTask',
    scriptLanguage: String(raw['@_scriptFormat'] ?? 'javascript'),
    script: extractText(raw['script']) ?? '',
  }
}

function parseManualTask(raw: Record<string, unknown>, flows: SequenceFlow[]): ManualTaskElement {
  return { ...baseElement(raw, flows), type: 'manualTask' }
}

function parseCallActivity(
  raw: Record<string, unknown>,
  flows: SequenceFlow[],
): CallActivityElement {
  return {
    ...baseElement(raw, flows),
    type: 'callActivity',
    calledElement: String(raw['@_calledElement'] ?? ''),
  }
}

// ── Gateways ──────────────────────────────────────────────────────────────────

function parseGateway(type: GatewayElement['type']) {
  return (raw: Record<string, unknown>, flows: SequenceFlow[]): GatewayElement => ({
    ...baseElement(raw, flows),
    type,
    ...(raw['@_default'] !== undefined ? { defaultFlow: String(raw['@_default']) } : {}),
    ...(type === 'eventBasedGateway' && raw['@_instantiate'] === 'true' ? { instantiate: true } : {}),
  })
}

// ── Sequence flows ────────────────────────────────────────────────────────────

function parseSequenceFlow(raw: Record<string, unknown>): SequenceFlow {
  const conditionRaw = (raw['conditionExpression'] as unknown[] | undefined)?.[0]
  const conditionExpression = conditionRaw !== undefined
    ? extractText(conditionRaw)
    : undefined

  return {
    id: String(raw['@_id'] ?? ''),
    sourceRef: String(raw['@_sourceRef'] ?? ''),
    targetRef: String(raw['@_targetRef'] ?? ''),
    ...(conditionExpression !== undefined ? { conditionExpression } : {}),
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(
  rawProcess: Record<string, unknown>,
  elements: BpmnFlowElement[],
  flows: SequenceFlow[],
  errors: ValidationError[],
): void {
  const elementIds = new Set(elements.map(e => e.id))

  // Must have at least one start event
  const startEvents = elements.filter(e => e.type === 'startEvent')
  if (startEvents.length === 0) {
    errors.push({ code: 'MISSING_START_EVENT', message: 'Process has no start event' })
  }

  // Must have at least one end event
  const endEvents = elements.filter(e => e.type === 'endEvent')
  if (endEvents.length === 0 && elements.length > 0) {
    errors.push({ code: 'MISSING_END_EVENT', message: 'Process has no end event' })
  }

  // Every flow must reference existing elements
  for (const flow of flows) {
    if (!elementIds.has(flow.sourceRef)) {
      errors.push({
        code: 'UNRESOLVED_FLOW_SOURCE',
        message: `Sequence flow "${flow.id}" references unknown source element "${flow.sourceRef}"`,
        elementId: flow.id,
      })
    }
    if (!elementIds.has(flow.targetRef)) {
      errors.push({
        code: 'UNRESOLVED_FLOW_TARGET',
        message: `Sequence flow "${flow.id}" references unknown target element "${flow.targetRef}"`,
        elementId: flow.id,
      })
    }
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function collectGateways(rawProcess: Record<string, unknown>): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  for (const key of ['exclusiveGateway', 'inclusiveGateway', 'parallelGateway', 'eventBasedGateway']) {
    result.push(...((rawProcess[key] ?? []) as Record<string, unknown>[]))
  }
  return result
}

function toStringArray(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String)
  return [String(value)]
}

function hasKey(obj: Record<string, unknown>, key: string): boolean {
  return key in obj && obj[key] !== undefined
}

function firstOf(value: unknown): unknown {
  if (Array.isArray(value)) return value[0]
  return value
}

function extractText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number') return String(value)
  const obj = value as Record<string, unknown>
  const text = obj['#text']
  if (text !== undefined) return String(text).trim() || undefined
  return undefined
}
