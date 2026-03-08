import type {
  ProcessDefinition,
  BpmnFlowElement,
  SequenceFlow,
  StartEventElement,
  EndEventElement,
  ServiceTaskElement,
  UserTaskElement,
  GatewayElement,
} from '../../../src/model/types.js'

const DEFAULT_DATE = new Date('2026-01-01T00:00:00.000Z')

export function buildDefinition(overrides: Partial<ProcessDefinition> = {}): ProcessDefinition {
  return {
    id: 'proc-1',
    version: 1,
    name: 'Test Process',
    elements: [],
    sequenceFlows: [],
    startEventId: 'start_1',
    deployedAt: DEFAULT_DATE,
    isDeployable: true,
    ...overrides,
  }
}

// ─── Pre-built Definitions ─────────────────────────────────────────────────────

/**
 * Start → End (simplest possible process)
 *
 * [Start] --flow_1--> [End]
 */
export function buildSimpleSequenceDefinition(): ProcessDefinition {
  const start: StartEventElement = {
    id: 'start_1',
    type: 'startEvent',
    eventDefinition: { type: 'none' },
    incomingFlows: [],
    outgoingFlows: ['flow_1'],
  }

  const end: EndEventElement = {
    id: 'end_1',
    type: 'endEvent',
    eventDefinition: { type: 'none' },
    incomingFlows: ['flow_1'],
    outgoingFlows: [],
  }

  const flow: SequenceFlow = { id: 'flow_1', sourceRef: 'start_1', targetRef: 'end_1' }

  return buildDefinition({
    elements: [start, end],
    sequenceFlows: [flow],
    startEventId: 'start_1',
  })
}

/**
 * Start → ServiceTask → End
 *
 * [Start] --flow_1--> [ServiceTask] --flow_2--> [End]
 */
export function buildServiceTaskDefinition(taskType = 'test-handler'): ProcessDefinition {
  const start: StartEventElement = {
    id: 'start_1',
    type: 'startEvent',
    eventDefinition: { type: 'none' },
    incomingFlows: [],
    outgoingFlows: ['flow_1'],
  }

  const task: ServiceTaskElement = {
    id: 'task_1',
    type: 'serviceTask',
    taskType,
    incomingFlows: ['flow_1'],
    outgoingFlows: ['flow_2'],
  }

  const end: EndEventElement = {
    id: 'end_1',
    type: 'endEvent',
    eventDefinition: { type: 'none' },
    incomingFlows: ['flow_2'],
    outgoingFlows: [],
  }

  return buildDefinition({
    elements: [start, task, end],
    sequenceFlows: [
      { id: 'flow_1', sourceRef: 'start_1', targetRef: 'task_1' },
      { id: 'flow_2', sourceRef: 'task_1', targetRef: 'end_1' },
    ],
    startEventId: 'start_1',
  })
}

/**
 * Start → UserTask → End
 *
 * [Start] --flow_1--> [UserTask] --flow_2--> [End]
 */
export function buildUserTaskDefinition(): ProcessDefinition {
  const start: StartEventElement = {
    id: 'start_1',
    type: 'startEvent',
    eventDefinition: { type: 'none' },
    incomingFlows: [],
    outgoingFlows: ['flow_1'],
  }

  const task: UserTaskElement = {
    id: 'task_1',
    type: 'userTask',
    name: 'Review Item',
    priority: 50,
    incomingFlows: ['flow_1'],
    outgoingFlows: ['flow_2'],
  }

  const end: EndEventElement = {
    id: 'end_1',
    type: 'endEvent',
    eventDefinition: { type: 'none' },
    incomingFlows: ['flow_2'],
    outgoingFlows: [],
  }

  return buildDefinition({
    elements: [start, task, end],
    sequenceFlows: [
      { id: 'flow_1', sourceRef: 'start_1', targetRef: 'task_1' },
      { id: 'flow_2', sourceRef: 'task_1', targetRef: 'end_1' },
    ],
    startEventId: 'start_1',
  })
}

/**
 * Start → XOR → [TaskA | TaskB] → End
 *
 * [Start] --> [XOR] --flow_a (amount > 100)--> [TaskA] --> [End]
 *                   --flow_b (default)-------> [TaskB] --> [End]
 */
export function buildXorGatewayDefinition(): ProcessDefinition {
  const elements: BpmnFlowElement[] = [
    { id: 'start_1', type: 'startEvent', eventDefinition: { type: 'none' }, incomingFlows: [], outgoingFlows: ['flow_1'] } as StartEventElement,
    { id: 'gw_xor', type: 'exclusiveGateway', defaultFlow: 'flow_b', incomingFlows: ['flow_1'], outgoingFlows: ['flow_a', 'flow_b'] } as GatewayElement,
    { id: 'task_a', type: 'serviceTask', taskType: 'high-value', incomingFlows: ['flow_a'], outgoingFlows: ['flow_end_a'] } as ServiceTaskElement,
    { id: 'task_b', type: 'serviceTask', taskType: 'standard', incomingFlows: ['flow_b'], outgoingFlows: ['flow_end_b'] } as ServiceTaskElement,
    { id: 'end_1', type: 'endEvent', eventDefinition: { type: 'none' }, incomingFlows: ['flow_end_a', 'flow_end_b'], outgoingFlows: [] } as EndEventElement,
  ]

  const sequenceFlows: SequenceFlow[] = [
    { id: 'flow_1',     sourceRef: 'start_1', targetRef: 'gw_xor' },
    { id: 'flow_a',     sourceRef: 'gw_xor',  targetRef: 'task_a', conditionExpression: 'amount > 100' },
    { id: 'flow_b',     sourceRef: 'gw_xor',  targetRef: 'task_b', isDefault: true },
    { id: 'flow_end_a', sourceRef: 'task_a',   targetRef: 'end_1' },
    { id: 'flow_end_b', sourceRef: 'task_b',   targetRef: 'end_1' },
  ]

  return buildDefinition({ elements, sequenceFlows, startEventId: 'start_1' })
}

/**
 * Start → AND split → [TaskA, TaskB, TaskC] → AND join → End
 *
 * [Start] --> [AND split] --> [TaskA] --> [AND join] --> [End]
 *                         --> [TaskB] -->
 *                         --> [TaskC] -->
 */
export function buildParallelGatewayDefinition(): ProcessDefinition {
  const elements: BpmnFlowElement[] = [
    { id: 'start_1',   type: 'startEvent',    eventDefinition: { type: 'none' }, incomingFlows: [],                              outgoingFlows: ['flow_1'] } as StartEventElement,
    { id: 'gw_split',  type: 'parallelGateway', incomingFlows: ['flow_1'],         outgoingFlows: ['flow_a', 'flow_b', 'flow_c'] } as GatewayElement,
    { id: 'task_a',    type: 'serviceTask',   taskType: 'branch-a',              incomingFlows: ['flow_a'],                      outgoingFlows: ['flow_join_a'] } as ServiceTaskElement,
    { id: 'task_b',    type: 'serviceTask',   taskType: 'branch-b',              incomingFlows: ['flow_b'],                      outgoingFlows: ['flow_join_b'] } as ServiceTaskElement,
    { id: 'task_c',    type: 'serviceTask',   taskType: 'branch-c',              incomingFlows: ['flow_c'],                      outgoingFlows: ['flow_join_c'] } as ServiceTaskElement,
    { id: 'gw_join',   type: 'parallelGateway', incomingFlows: ['flow_join_a', 'flow_join_b', 'flow_join_c'], outgoingFlows: ['flow_end'] } as GatewayElement,
    { id: 'end_1',     type: 'endEvent',      eventDefinition: { type: 'none' }, incomingFlows: ['flow_end'],                    outgoingFlows: [] } as EndEventElement,
  ]

  const sequenceFlows: SequenceFlow[] = [
    { id: 'flow_1',      sourceRef: 'start_1',  targetRef: 'gw_split' },
    { id: 'flow_a',      sourceRef: 'gw_split', targetRef: 'task_a' },
    { id: 'flow_b',      sourceRef: 'gw_split', targetRef: 'task_b' },
    { id: 'flow_c',      sourceRef: 'gw_split', targetRef: 'task_c' },
    { id: 'flow_join_a', sourceRef: 'task_a',   targetRef: 'gw_join' },
    { id: 'flow_join_b', sourceRef: 'task_b',   targetRef: 'gw_join' },
    { id: 'flow_join_c', sourceRef: 'task_c',   targetRef: 'gw_join' },
    { id: 'flow_end',    sourceRef: 'gw_join',  targetRef: 'end_1' },
  ]

  return buildDefinition({ elements, sequenceFlows, startEventId: 'start_1' })
}
