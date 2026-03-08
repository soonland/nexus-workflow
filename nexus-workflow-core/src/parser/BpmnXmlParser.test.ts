import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBpmn } from './BpmnXmlParser.js'
import { DefinitionError } from '../model/errors.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fixtureDir = join(import.meta.dirname, '../../tests/fixtures/bpmn')

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf-8')
}

// ─── Simple sequence ──────────────────────────────────────────────────────────

describe('BpmnXmlParser — simple sequence', () => {
  it('parses a minimal Start → End process without errors', () => {
    const xml = loadFixture('simple-sequence.bpmn')
    const { definition, errors } = parseBpmn(xml)
    expect(errors).toHaveLength(0)
    expect(definition).not.toBeNull()
  })

  it('extracts the process id and name', () => {
    const { definition } = parseBpmn(loadFixture('simple-sequence.bpmn'))
    expect(definition!.id).toBe('proc_simple')
    expect(definition!.name).toBe('Simple Sequence')
  })

  it('sets the startEventId to the sole start event', () => {
    const { definition } = parseBpmn(loadFixture('simple-sequence.bpmn'))
    expect(definition!.startEventId).toBe('start_1')
  })

  it('parses the start event as a none startEvent element', () => {
    const { definition } = parseBpmn(loadFixture('simple-sequence.bpmn'))
    const start = definition!.elements.find(e => e.id === 'start_1')
    expect(start?.type).toBe('startEvent')
    expect((start as any).eventDefinition.type).toBe('none')
  })

  it('parses the end event as a none endEvent element', () => {
    const { definition } = parseBpmn(loadFixture('simple-sequence.bpmn'))
    const end = definition!.elements.find(e => e.id === 'end_1')
    expect(end?.type).toBe('endEvent')
    expect((end as any).eventDefinition.type).toBe('none')
  })

  it('populates outgoing flows on the start event', () => {
    const { definition } = parseBpmn(loadFixture('simple-sequence.bpmn'))
    const start = definition!.elements.find(e => e.id === 'start_1')
    expect(start?.outgoingFlows).toEqual(['flow_1'])
  })

  it('populates incoming flows on the end event', () => {
    const { definition } = parseBpmn(loadFixture('simple-sequence.bpmn'))
    const end = definition!.elements.find(e => e.id === 'end_1')
    expect(end?.incomingFlows).toEqual(['flow_1'])
  })

  it('parses the sequence flow with correct sourceRef and targetRef', () => {
    const { definition } = parseBpmn(loadFixture('simple-sequence.bpmn'))
    const flow = definition!.sequenceFlows.find(f => f.id === 'flow_1')
    expect(flow?.sourceRef).toBe('start_1')
    expect(flow?.targetRef).toBe('end_1')
  })

  it('marks the definition as deployable', () => {
    const { definition } = parseBpmn(loadFixture('simple-sequence.bpmn'))
    expect(definition!.isDeployable).toBe(true)
  })
})

// ─── Service task ─────────────────────────────────────────────────────────────

describe('BpmnXmlParser — service task', () => {
  it('parses a service task element', () => {
    const { definition } = parseBpmn(loadFixture('service-task.bpmn'))
    const task = definition!.elements.find(e => e.id === 'task_1')
    expect(task?.type).toBe('serviceTask')
  })

  it('extracts the task name', () => {
    const { definition } = parseBpmn(loadFixture('service-task.bpmn'))
    const task = definition!.elements.find(e => e.id === 'task_1')
    expect(task?.name).toBe('Call External API')
  })

  it('extracts the custom task type from extension attributes', () => {
    const { definition } = parseBpmn(loadFixture('service-task.bpmn'))
    const task = definition!.elements.find(e => e.id === 'task_1') as any
    expect(task?.taskType).toBe('http-call')
  })

  it('connects incoming and outgoing flows correctly', () => {
    const { definition } = parseBpmn(loadFixture('service-task.bpmn'))
    const task = definition!.elements.find(e => e.id === 'task_1')
    expect(task?.incomingFlows).toEqual(['flow_1'])
    expect(task?.outgoingFlows).toEqual(['flow_2'])
  })
})

// ─── XOR gateway ──────────────────────────────────────────────────────────────

describe('BpmnXmlParser — XOR gateway', () => {
  it('parses an exclusiveGateway element', () => {
    const { definition } = parseBpmn(loadFixture('xor-gateway.bpmn'))
    const gw = definition!.elements.find(e => e.id === 'gw_xor')
    expect(gw?.type).toBe('exclusiveGateway')
  })

  it('extracts the default flow reference', () => {
    const { definition } = parseBpmn(loadFixture('xor-gateway.bpmn'))
    const gw = definition!.elements.find(e => e.id === 'gw_xor') as any
    expect(gw?.defaultFlow).toBe('flow_b')
  })

  it('extracts the condition expression from a sequence flow', () => {
    const { definition } = parseBpmn(loadFixture('xor-gateway.bpmn'))
    const flow = definition!.sequenceFlows.find(f => f.id === 'flow_a')
    expect(flow?.conditionExpression).toBe('amount > 100')
  })

  it('does not set conditionExpression on an unconditional flow', () => {
    const { definition } = parseBpmn(loadFixture('xor-gateway.bpmn'))
    const flow = definition!.sequenceFlows.find(f => f.id === 'flow_b')
    expect(flow?.conditionExpression).toBeUndefined()
  })

  it('marks the default flow with isDefault', () => {
    const { definition } = parseBpmn(loadFixture('xor-gateway.bpmn'))
    const flow = definition!.sequenceFlows.find(f => f.id === 'flow_b')
    expect(flow?.isDefault).toBe(true)
  })
})

// ─── Parallel gateway ─────────────────────────────────────────────────────────

describe('BpmnXmlParser — parallel gateway', () => {
  it('parses both split and join as parallelGateway elements', () => {
    const { definition } = parseBpmn(loadFixture('parallel-gateway.bpmn'))
    const gateways = definition!.elements.filter(e => e.type === 'parallelGateway')
    expect(gateways).toHaveLength(2)
  })

  it('gives the split gateway 3 outgoing flows', () => {
    const { definition } = parseBpmn(loadFixture('parallel-gateway.bpmn'))
    const split = definition!.elements.find(e => e.id === 'gw_split')
    expect(split?.outgoingFlows).toHaveLength(3)
  })

  it('gives the join gateway 3 incoming flows', () => {
    const { definition } = parseBpmn(loadFixture('parallel-gateway.bpmn'))
    const join = definition!.elements.find(e => e.id === 'gw_join')
    expect(join?.incomingFlows).toHaveLength(3)
  })

  it('parses all 3 service tasks', () => {
    const { definition } = parseBpmn(loadFixture('parallel-gateway.bpmn'))
    const tasks = definition!.elements.filter(e => e.type === 'serviceTask')
    expect(tasks).toHaveLength(3)
  })
})

// ─── Boundary timer event ─────────────────────────────────────────────────────

describe('BpmnXmlParser — boundary timer event', () => {
  it('parses the boundary event element', () => {
    const { definition } = parseBpmn(loadFixture('boundary-timer.bpmn'))
    const boundary = definition!.elements.find(e => e.id === 'boundary_timer')
    expect(boundary?.type).toBe('boundaryEvent')
  })

  it('sets attachedToRef on the boundary event', () => {
    const { definition } = parseBpmn(loadFixture('boundary-timer.bpmn'))
    const boundary = definition!.elements.find(e => e.id === 'boundary_timer') as any
    expect(boundary?.attachedToRef).toBe('task_1')
  })

  it('sets cancelActivity to true for an interrupting boundary', () => {
    const { definition } = parseBpmn(loadFixture('boundary-timer.bpmn'))
    const boundary = definition!.elements.find(e => e.id === 'boundary_timer') as any
    expect(boundary?.cancelActivity).toBe(true)
  })

  it('extracts the timer event definition with duration expression', () => {
    const { definition } = parseBpmn(loadFixture('boundary-timer.bpmn'))
    const boundary = definition!.elements.find(e => e.id === 'boundary_timer') as any
    expect(boundary?.eventDefinition.type).toBe('timer')
    expect(boundary?.eventDefinition.timerExpression).toBe('PT1H')
  })
})

// ─── Validation ───────────────────────────────────────────────────────────────

describe('BpmnXmlParser — validation', () => {
  it('returns a DefinitionError for completely invalid XML', () => {
    expect(() => parseBpmn('not xml at all <<<')).toThrow(DefinitionError)
  })

  it('returns an error when the process has no start event', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
      <bpmn:process id="proc_1" isExecutable="true">
        <bpmn:endEvent id="end_1"/>
      </bpmn:process>
    </bpmn:definitions>`
    const { errors } = parseBpmn(xml)
    expect(errors.some(e => e.code === 'MISSING_START_EVENT')).toBe(true)
  })

  it('returns an error when a sequence flow references a missing element', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
      <bpmn:process id="proc_1" isExecutable="true">
        <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
        <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="nonexistent_element"/>
      </bpmn:process>
    </bpmn:definitions>`
    const { errors } = parseBpmn(xml)
    expect(errors.some(e => e.code === 'UNRESOLVED_FLOW_TARGET')).toBe(true)
  })

  it('returns an error when a process has no elements at all', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
      <bpmn:process id="proc_1" isExecutable="true"/>
    </bpmn:definitions>`
    const { errors } = parseBpmn(xml)
    expect(errors.length).toBeGreaterThan(0)
  })
})

// ─── Round-trip: parse then execute ───────────────────────────────────────────

describe('BpmnXmlParser — parse → execute round-trip', () => {
  it('a parsed simple-sequence definition runs to completion in the engine', async () => {
    const { execute } = await import('../engine/ExecutionEngine.js')
    const { definition } = parseBpmn(loadFixture('simple-sequence.bpmn'))

    let idCounter = 0
    const { newState } = execute(definition!, { type: 'StartProcess' }, null, {
      generateId: () => `id-${++idCounter}`,
    })

    expect(newState.instance.status).toBe('completed')
  })

  it('a parsed parallel-gateway definition runs all branches to completion', async () => {
    const { execute } = await import('../engine/ExecutionEngine.js')
    const { definition } = parseBpmn(loadFixture('parallel-gateway.bpmn'))

    let idCounter = 0
    const opts = { generateId: () => `id-${++idCounter}` }
    const def = definition!

    const { newState: s0 } = execute(def, { type: 'StartProcess' }, null, opts)
    expect(s0.tokens.filter(t => t.status === 'waiting')).toHaveLength(3)

    let state = s0
    for (const token of s0.tokens.filter(t => t.status === 'waiting')) {
      const result = execute(def, { type: 'CompleteServiceTask', tokenId: token.id }, state, opts)
      state = result.newState
    }

    expect(state.instance.status).toBe('completed')
  })
})
