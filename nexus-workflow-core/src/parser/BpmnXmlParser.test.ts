import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { DefinitionError } from '../model/errors.js'
import { parseBpmn } from './BpmnXmlParser.js'

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

// ─── Script task ──────────────────────────────────────────────────────────────

describe('BpmnXmlParser — script task', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
    <bpmn:process id="proc_1" isExecutable="true">
      <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:scriptTask id="script_1" scriptFormat="javascript">
        <bpmn:incoming>flow_1</bpmn:incoming>
        <bpmn:outgoing>flow_2</bpmn:outgoing>
        <bpmn:script>x + 1</bpmn:script>
      </bpmn:scriptTask>
      <bpmn:endEvent id="end_1"><bpmn:incoming>flow_2</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="script_1"/>
      <bpmn:sequenceFlow id="flow_2" sourceRef="script_1" targetRef="end_1"/>
    </bpmn:process>
  </bpmn:definitions>`

  it('parses a scriptTask element', () => {
    const { definition, errors } = parseBpmn(xml)
    expect(errors).toHaveLength(0)
    const task = definition!.elements.find(e => e.id === 'script_1')
    expect(task?.type).toBe('scriptTask')
  })

  it('extracts the scriptLanguage from scriptFormat attribute', () => {
    const { definition } = parseBpmn(xml)
    const task = definition!.elements.find(e => e.id === 'script_1') as any
    expect(task?.scriptLanguage).toBe('javascript')
  })

  it('extracts the script body text (exercises extractText with plain string)', () => {
    const { definition } = parseBpmn(xml)
    const task = definition!.elements.find(e => e.id === 'script_1') as any
    // The parser uses extractText on raw['script'] — this exercises the string trim path
    expect(task?.script).toBe('x + 1')
  })
})

// ─── Manual task ──────────────────────────────────────────────────────────────

describe('BpmnXmlParser — manual task', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
    <bpmn:process id="proc_1" isExecutable="true">
      <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:manualTask id="manual_1">
        <bpmn:incoming>flow_1</bpmn:incoming>
        <bpmn:outgoing>flow_2</bpmn:outgoing>
      </bpmn:manualTask>
      <bpmn:endEvent id="end_1"><bpmn:incoming>flow_2</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="manual_1"/>
      <bpmn:sequenceFlow id="flow_2" sourceRef="manual_1" targetRef="end_1"/>
    </bpmn:process>
  </bpmn:definitions>`

  it('parses a manualTask element', () => {
    const { definition, errors } = parseBpmn(xml)
    expect(errors).toHaveLength(0)
    const task = definition!.elements.find(e => e.id === 'manual_1')
    expect(task?.type).toBe('manualTask')
  })
})

// ─── Call activity ────────────────────────────────────────────────────────────

describe('BpmnXmlParser — call activity', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
    <bpmn:process id="proc_1" isExecutable="true">
      <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:callActivity id="call_1" calledElement="sub-process-1">
        <bpmn:incoming>flow_1</bpmn:incoming>
        <bpmn:outgoing>flow_2</bpmn:outgoing>
      </bpmn:callActivity>
      <bpmn:endEvent id="end_1"><bpmn:incoming>flow_2</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="call_1"/>
      <bpmn:sequenceFlow id="flow_2" sourceRef="call_1" targetRef="end_1"/>
    </bpmn:process>
  </bpmn:definitions>`

  it('parses a callActivity element', () => {
    const { definition, errors } = parseBpmn(xml)
    expect(errors).toHaveLength(0)
    const ca = definition!.elements.find(e => e.id === 'call_1')
    expect(ca?.type).toBe('callActivity')
  })

  it('extracts calledElement from the attribute', () => {
    const { definition } = parseBpmn(xml)
    const ca = definition!.elements.find(e => e.id === 'call_1') as any
    expect(ca?.calledElement).toBe('sub-process-1')
  })
})

// ─── Terminate end event ───────────────────────────────────────────────────────

describe('BpmnXmlParser — terminate end event', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
    <bpmn:process id="proc_1" isExecutable="true">
      <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:endEvent id="end_terminate">
        <bpmn:incoming>flow_1</bpmn:incoming>
        <bpmn:terminateEventDefinition/>
      </bpmn:endEvent>
      <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="end_terminate"/>
    </bpmn:process>
  </bpmn:definitions>`

  it('parses a terminate end event definition', () => {
    const { definition } = parseBpmn(xml)
    const end = definition!.elements.find(e => e.id === 'end_terminate') as any
    expect(end?.eventDefinition?.type).toBe('terminate')
  })
})

// ─── User task attributes ─────────────────────────────────────────────────────

describe('BpmnXmlParser — user task attributes', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
    <bpmn:process id="proc_1" isExecutable="true">
      <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:userTask id="ut_1" name="Approve Request" assignee="alice" formKey="form-123">
        <bpmn:incoming>flow_1</bpmn:incoming>
        <bpmn:outgoing>flow_2</bpmn:outgoing>
      </bpmn:userTask>
      <bpmn:endEvent id="end_1"><bpmn:incoming>flow_2</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="ut_1"/>
      <bpmn:sequenceFlow id="flow_2" sourceRef="ut_1" targetRef="end_1"/>
    </bpmn:process>
  </bpmn:definitions>`

  it('parses a userTask element', () => {
    const { definition, errors } = parseBpmn(xml)
    expect(errors).toHaveLength(0)
    const task = definition!.elements.find(e => e.id === 'ut_1')
    expect(task?.type).toBe('userTask')
  })

  it('extracts the assignee attribute', () => {
    const { definition } = parseBpmn(xml)
    const task = definition!.elements.find(e => e.id === 'ut_1') as any
    expect(task?.assignee).toBe('alice')
  })

  it('extracts the formKey attribute', () => {
    const { definition } = parseBpmn(xml)
    const task = definition!.elements.find(e => e.id === 'ut_1') as any
    expect(task?.formKey).toBe('form-123')
  })
})

// ─── Intermediate signal catch event ──────────────────────────────────────────

describe('BpmnXmlParser — intermediate signal catch event', () => {
  it('parses the signal catch event element', () => {
    const { definition } = parseBpmn(loadFixture('intermediate-signal.bpmn'))
    const el = definition!.elements.find(e => e.type === 'intermediateCatchEvent')
    expect(el).toBeDefined()
  })

  it('sets the eventDefinition type to signal', () => {
    const { definition } = parseBpmn(loadFixture('intermediate-signal.bpmn'))
    const el = definition!.elements.find(e => e.type === 'intermediateCatchEvent') as any
    expect(el?.eventDefinition?.type).toBe('signal')
  })
})

// ─── Validation — unresolved flow source ──────────────────────────────────────

describe('BpmnXmlParser — validation: unresolved flow source', () => {
  it('returns an UNRESOLVED_FLOW_SOURCE error when sourceRef is missing', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
      <bpmn:process id="proc_1" isExecutable="true">
        <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
        <bpmn:endEvent id="end_1"><bpmn:incoming>flow_1</bpmn:incoming></bpmn:endEvent>
        <bpmn:sequenceFlow id="flow_1" sourceRef="MISSING_SOURCE" targetRef="end_1"/>
      </bpmn:process>
    </bpmn:definitions>`
    const { errors } = parseBpmn(xml)
    expect(errors.some(e => e.code === 'UNRESOLVED_FLOW_SOURCE')).toBe(true)
  })
})

// ─── Validation — missing end event ───────────────────────────────────────────

describe('BpmnXmlParser — validation: missing end event', () => {
  it('returns a MISSING_END_EVENT error when the process has only a start event', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
      <bpmn:process id="proc_1" isExecutable="true">
        <bpmn:startEvent id="start_1"/>
      </bpmn:process>
    </bpmn:definitions>`
    const { errors } = parseBpmn(xml)
    expect(errors.some(e => e.code === 'MISSING_END_EVENT')).toBe(true)
  })
})

// ─── extractText — numeric and #text object paths ─────────────────────────────
//
// The parser's extractText helper has three non-trivial paths:
//   1. value is a string → trim and return
//   2. value is a number → String(value)
//   3. value is an object with a '#text' key → use that
//
// Path 1 is exercised by every script text extraction above.
// Paths 2 and 3 are exercised by having fast-xml-parser produce those shapes.
// The timer duration (timeDuration) element uses extractText and, when the duration
// is a pure number like "3600", fast-xml-parser may return a number primitive.
// We simulate both shapes through inline XML.

describe('BpmnXmlParser — extractText paths', () => {
  it('extracts timer duration from a timeDuration element (string shape)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
      <bpmn:process id="proc_1" isExecutable="true">
        <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
        <bpmn:intermediateCatchEvent id="timer_1">
          <bpmn:incoming>flow_1</bpmn:incoming>
          <bpmn:outgoing>flow_2</bpmn:outgoing>
          <bpmn:timerEventDefinition>
            <bpmn:timeDuration>PT2H</bpmn:timeDuration>
          </bpmn:timerEventDefinition>
        </bpmn:intermediateCatchEvent>
        <bpmn:endEvent id="end_1"><bpmn:incoming>flow_2</bpmn:incoming></bpmn:endEvent>
        <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="timer_1"/>
        <bpmn:sequenceFlow id="flow_2" sourceRef="timer_1" targetRef="end_1"/>
      </bpmn:process>
    </bpmn:definitions>`

    const { definition } = parseBpmn(xml)
    const el = definition!.elements.find(e => e.id === 'timer_1') as any
    expect(el?.eventDefinition?.timerExpression).toBe('PT2H')
  })

  it('extracts timer duration when the value is a pure number (number shape → String())', () => {
    // fast-xml-parser converts numeric-only text to a JS number.
    // A timeDuration of "3600" becomes the number 3600, triggering extractText's number branch.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
      <bpmn:process id="proc_1" isExecutable="true">
        <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
        <bpmn:intermediateCatchEvent id="timer_1">
          <bpmn:incoming>flow_1</bpmn:incoming>
          <bpmn:outgoing>flow_2</bpmn:outgoing>
          <bpmn:timerEventDefinition>
            <bpmn:timeDuration>3600</bpmn:timeDuration>
          </bpmn:timerEventDefinition>
        </bpmn:intermediateCatchEvent>
        <bpmn:endEvent id="end_1"><bpmn:incoming>flow_2</bpmn:incoming></bpmn:endEvent>
        <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="timer_1"/>
        <bpmn:sequenceFlow id="flow_2" sourceRef="timer_1" targetRef="end_1"/>
      </bpmn:process>
    </bpmn:definitions>`

    const { definition } = parseBpmn(xml)
    const el = definition!.elements.find(e => e.id === 'timer_1') as any
    // extractText converts the number 3600 to the string "3600"
    expect(el?.eventDefinition?.timerExpression).toBe('3600')
  })

  it('extracts condition expression when fast-xml-parser wraps text in a #text object', () => {
    // When a conditionExpression element contains mixed content, fast-xml-parser
    // may produce { '#text': 'amount > 100' }. This exercises the obj['#text'] branch.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D1" targetNamespace="x">
      <bpmn:process id="proc_1" isExecutable="true">
        <bpmn:startEvent id="start_1"><bpmn:outgoing>flow_1</bpmn:outgoing></bpmn:startEvent>
        <bpmn:exclusiveGateway id="gw_1" default="flow_b">
          <bpmn:incoming>flow_1</bpmn:incoming>
          <bpmn:outgoing>flow_a</bpmn:outgoing>
          <bpmn:outgoing>flow_b</bpmn:outgoing>
        </bpmn:exclusiveGateway>
        <bpmn:endEvent id="end_a"><bpmn:incoming>flow_a</bpmn:incoming></bpmn:endEvent>
        <bpmn:endEvent id="end_b"><bpmn:incoming>flow_b</bpmn:incoming></bpmn:endEvent>
        <bpmn:sequenceFlow id="flow_1" sourceRef="start_1" targetRef="gw_1"/>
        <bpmn:sequenceFlow id="flow_a" sourceRef="gw_1" targetRef="end_a">
          <bpmn:conditionExpression xsi:type="tFormalExpression" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">amount &gt; 100</bpmn:conditionExpression>
        </bpmn:sequenceFlow>
        <bpmn:sequenceFlow id="flow_b" sourceRef="gw_1" targetRef="end_b"/>
      </bpmn:process>
    </bpmn:definitions>`

    const { definition } = parseBpmn(xml)
    const condFlow = definition!.sequenceFlows.find(f => f.id === 'flow_a')
    // The condition expression should be extracted correctly regardless of shape
    expect(condFlow?.conditionExpression).toBeTruthy()
    expect(typeof condFlow?.conditionExpression).toBe('string')
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

// ─── Multi-instance loop characteristics ──────────────────────────────────────

describe('BpmnXmlParser — multiInstanceLoopCharacteristics', () => {
  const parallelMiBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://test">
  <process id="proc_mi" name="MI Process">
    <startEvent id="start_1"><outgoing>flow_1</outgoing></startEvent>
    <serviceTask id="task_1">
      <incoming>flow_1</incoming>
      <outgoing>flow_2</outgoing>
      <multiInstanceLoopCharacteristics isSequential="false">
        <loopDataInputRef>items</loopDataInputRef>
        <inputDataItem name="item"/>
        <outputDataItem name="result"/>
        <loopDataOutputRef>results</loopDataOutputRef>
        <completionCondition>done === true</completionCondition>
      </multiInstanceLoopCharacteristics>
    </serviceTask>
    <endEvent id="end_1"><incoming>flow_2</incoming></endEvent>
    <sequenceFlow id="flow_1" sourceRef="start_1" targetRef="task_1"/>
    <sequenceFlow id="flow_2" sourceRef="task_1" targetRef="end_1"/>
  </process>
</definitions>`

  const sequentialMiBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://test">
  <process id="proc_mi_seq" name="MI Sequential">
    <startEvent id="start_1"><outgoing>flow_1</outgoing></startEvent>
    <userTask id="task_1">
      <incoming>flow_1</incoming>
      <outgoing>flow_2</outgoing>
      <multiInstanceLoopCharacteristics isSequential="true">
        <loopDataInputRef>approvers</loopDataInputRef>
        <inputDataItem name="approver"/>
      </multiInstanceLoopCharacteristics>
    </userTask>
    <endEvent id="end_1"><incoming>flow_2</incoming></endEvent>
    <sequenceFlow id="flow_1" sourceRef="start_1" targetRef="task_1"/>
    <sequenceFlow id="flow_2" sourceRef="task_1" targetRef="end_1"/>
  </process>
</definitions>`

  it('parses parallel multiInstanceLoopCharacteristics on a service task', () => {
    const { definition, errors } = parseBpmn(parallelMiBpmn)
    expect(errors).toHaveLength(0)
    const task = definition!.elements.find(e => e.id === 'task_1') as any
    expect(task.loopCharacteristics).toBeDefined()
    expect(task.loopCharacteristics.isSequential).toBe(false)
    expect(task.loopCharacteristics.inputCollection).toBe('items')
    expect(task.loopCharacteristics.inputElement).toBe('item')
    expect(task.loopCharacteristics.outputElement).toBe('result')
    expect(task.loopCharacteristics.outputCollection).toBe('results')
    expect(task.loopCharacteristics.completionCondition).toBe('done === true')
  })

  it('parses sequential multiInstanceLoopCharacteristics on a user task', () => {
    const { definition, errors } = parseBpmn(sequentialMiBpmn)
    expect(errors).toHaveLength(0)
    const task = definition!.elements.find(e => e.id === 'task_1') as any
    expect(task.loopCharacteristics).toBeDefined()
    expect(task.loopCharacteristics.isSequential).toBe(true)
    expect(task.loopCharacteristics.inputCollection).toBe('approvers')
    expect(task.loopCharacteristics.inputElement).toBe('approver')
    expect(task.loopCharacteristics.outputElement).toBeUndefined()
    expect(task.loopCharacteristics.outputCollection).toBeUndefined()
    expect(task.loopCharacteristics.completionCondition).toBeUndefined()
  })

  it('tasks without multiInstanceLoopCharacteristics have no loopCharacteristics property', () => {
    const { definition } = parseBpmn(loadFixture('service-task.bpmn'))
    const task = definition!.elements.find(e => e.id === 'task_1') as any
    expect(task.loopCharacteristics).toBeUndefined()
  })
})

// ─── Compensation parsing ──────────────────────────────────────────────────────

describe('compensation element parsing', () => {
  const compensationBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://test">
  <process id="comp_proc" isExecutable="true">
    <startEvent id="start_1"><outgoing>f1</outgoing></startEvent>
    <serviceTask id="task_1"><incoming>f1</incoming><outgoing>f2</outgoing></serviceTask>
    <serviceTask id="handler_1" isForCompensation="true"></serviceTask>
    <userTask id="handler_user" isForCompensation="true"></userTask>
    <intermediateThrowEvent id="throw_comp_all">
      <incoming>f2</incoming><outgoing>f3</outgoing>
      <compensateEventDefinition/>
    </intermediateThrowEvent>
    <intermediateThrowEvent id="throw_comp_targeted">
      <compensateEventDefinition activityRef="task_1"/>
    </intermediateThrowEvent>
    <boundaryEvent id="boundary_comp" attachedToRef="task_1" cancelActivity="false">
      <compensateEventDefinition activityRef="handler_1"/>
    </boundaryEvent>
    <endEvent id="end_1"><incoming>f3</incoming></endEvent>
    <sequenceFlow id="f1" sourceRef="start_1" targetRef="task_1"/>
    <sequenceFlow id="f2" sourceRef="task_1" targetRef="throw_comp_all"/>
    <sequenceFlow id="f3" sourceRef="throw_comp_all" targetRef="end_1"/>
  </process>
</definitions>`

  it('parses intermediateThrowEvent with compensation (no activityRef)', () => {
    const { definition, errors } = parseBpmn(compensationBpmn)
    expect(errors).toHaveLength(0)
    const throwAll = definition!.elements.find(e => e.id === 'throw_comp_all') as any
    expect(throwAll.type).toBe('intermediateThrowEvent')
    expect(throwAll.eventDefinition.type).toBe('compensation')
    expect(throwAll.eventDefinition.compensationActivityRef).toBeUndefined()
  })

  it('parses intermediateThrowEvent with compensationActivityRef', () => {
    const { definition } = parseBpmn(compensationBpmn)
    const throwTargeted = definition!.elements.find(e => e.id === 'throw_comp_targeted') as any
    expect(throwTargeted.eventDefinition.type).toBe('compensation')
    expect(throwTargeted.eventDefinition.compensationActivityRef).toBe('task_1')
  })

  it('parses compensation boundary event and forces cancelActivity: false', () => {
    const { definition } = parseBpmn(compensationBpmn)
    const boundary = definition!.elements.find(e => e.id === 'boundary_comp') as any
    expect(boundary.eventDefinition.type).toBe('compensation')
    expect(boundary.eventDefinition.compensationActivityRef).toBe('handler_1')
    expect(boundary.cancelActivity).toBe(false)
  })

  it('parses isForCompensation on service task', () => {
    const { definition } = parseBpmn(compensationBpmn)
    const handler = definition!.elements.find(e => e.id === 'handler_1') as any
    expect(handler.isForCompensation).toBe(true)
  })

  it('parses isForCompensation on user task', () => {
    const { definition } = parseBpmn(compensationBpmn)
    const handler = definition!.elements.find(e => e.id === 'handler_user') as any
    expect(handler.isForCompensation).toBe(true)
  })

  it('normal service task has no isForCompensation property', () => {
    const { definition } = parseBpmn(compensationBpmn)
    const task = definition!.elements.find(e => e.id === 'task_1') as any
    expect(task.isForCompensation).toBeUndefined()
  })
})

// ─── Sub-process ──────────────────────────────────────────────────────────────

const subProcessBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://example.com">
  <process id="proc_sub" name="Sub-Process Test">
    <startEvent id="start_1"><outgoing>f1</outgoing></startEvent>
    <subProcess id="sub_1" name="My Sub-Process">
      <incoming>f1</incoming><outgoing>f2</outgoing>
      <startEvent id="inner_start"><outgoing>if1</outgoing></startEvent>
      <serviceTask id="inner_task" name="Inner Task"><incoming>if1</incoming><outgoing>if2</outgoing></serviceTask>
      <endEvent id="inner_end"><incoming>if2</incoming></endEvent>
      <sequenceFlow id="if1" sourceRef="inner_start" targetRef="inner_task"/>
      <sequenceFlow id="if2" sourceRef="inner_task" targetRef="inner_end"/>
    </subProcess>
    <endEvent id="end_1"><incoming>f2</incoming></endEvent>
    <sequenceFlow id="f1" sourceRef="start_1" targetRef="sub_1"/>
    <sequenceFlow id="f2" sourceRef="sub_1" targetRef="end_1"/>
  </process>
</definitions>`

describe('BpmnXmlParser — sub-process', () => {
  it('parses a sub-process element without errors', () => {
    const { definition, errors } = parseBpmn(subProcessBpmn)
    expect(errors).toHaveLength(0)
    expect(definition).not.toBeNull()
  })

  it('places sub-process as a top-level element', () => {
    const { definition } = parseBpmn(subProcessBpmn)
    const sub = definition!.elements.find(e => e.id === 'sub_1')
    expect(sub).toBeDefined()
    expect(sub!.type).toBe('subProcess')
  })

  it('parses inner elements inside the sub-process', () => {
    const { definition } = parseBpmn(subProcessBpmn)
    const sub = definition!.elements.find(e => e.id === 'sub_1') as any
    expect(sub.elements.length).toBe(3)
    expect(sub.elements.find((e: any) => e.id === 'inner_task')?.type).toBe('serviceTask')
  })

  it('sets startEventId on the sub-process', () => {
    const { definition } = parseBpmn(subProcessBpmn)
    const sub = definition!.elements.find(e => e.id === 'sub_1') as any
    expect(sub.startEventId).toBe('inner_start')
  })

  it('parses inner sequence flows', () => {
    const { definition } = parseBpmn(subProcessBpmn)
    const sub = definition!.elements.find(e => e.id === 'sub_1') as any
    expect(sub.sequenceFlows.length).toBe(2)
    expect(sub.sequenceFlows.find((f: any) => f.id === 'if1')).toBeDefined()
  })

  it('does not set isTransaction on a plain sub-process', () => {
    const { definition } = parseBpmn(subProcessBpmn)
    const sub = definition!.elements.find(e => e.id === 'sub_1') as any
    expect(sub.isTransaction).toBeUndefined()
  })

  it('sub-process element has correct incomingFlows and outgoingFlows', () => {
    const { definition } = parseBpmn(subProcessBpmn)
    const sub = definition!.elements.find(e => e.id === 'sub_1') as any
    expect(sub.incomingFlows).toContain('f1')
    expect(sub.outgoingFlows).toContain('f2')
  })
})

// ─── Transaction ──────────────────────────────────────────────────────────────

const transactionBpmn = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             targetNamespace="http://example.com">
  <process id="proc_txn" name="Transaction Test">
    <startEvent id="start_1"><outgoing>f1</outgoing></startEvent>
    <transaction id="txn_1" name="My Transaction">
      <incoming>f1</incoming>
      <startEvent id="t_start"><outgoing>tf1</outgoing></startEvent>
      <serviceTask id="t_task"><incoming>tf1</incoming><outgoing>tf2</outgoing></serviceTask>
      <endEvent id="t_cancel_end">
        <incoming>tf2</incoming>
        <cancelEventDefinition/>
      </endEvent>
      <sequenceFlow id="tf1" sourceRef="t_start" targetRef="t_task"/>
      <sequenceFlow id="tf2" sourceRef="t_task" targetRef="t_cancel_end"/>
    </transaction>
    <boundaryEvent id="cancel_boundary" attachedToRef="txn_1" cancelActivity="true">
      <outgoing>f2</outgoing>
      <cancelEventDefinition/>
    </boundaryEvent>
    <endEvent id="end_1"><incoming>f2</incoming></endEvent>
    <sequenceFlow id="f1" sourceRef="start_1" targetRef="txn_1"/>
    <sequenceFlow id="f2" sourceRef="cancel_boundary" targetRef="end_1"/>
  </process>
</definitions>`

describe('BpmnXmlParser — transaction', () => {
  it('parses a transaction element without errors', () => {
    const { definition, errors } = parseBpmn(transactionBpmn)
    expect(errors).toHaveLength(0)
    expect(definition).not.toBeNull()
  })

  it('creates a subProcess element with isTransaction: true', () => {
    const { definition } = parseBpmn(transactionBpmn)
    const txn = definition!.elements.find(e => e.id === 'txn_1') as any
    expect(txn).toBeDefined()
    expect(txn.type).toBe('subProcess')
    expect(txn.isTransaction).toBe(true)
  })

  it('parses the cancel end event inside the transaction', () => {
    const { definition } = parseBpmn(transactionBpmn)
    const txn = definition!.elements.find(e => e.id === 'txn_1') as any
    const cancelEnd = txn.elements.find((e: any) => e.id === 't_cancel_end')
    expect(cancelEnd).toBeDefined()
    expect(cancelEnd.eventDefinition.type).toBe('cancel')
  })

  it('parses the cancel boundary event attached to the transaction', () => {
    const { definition } = parseBpmn(transactionBpmn)
    const boundary = definition!.elements.find(e => e.id === 'cancel_boundary') as any
    expect(boundary).toBeDefined()
    expect(boundary.type).toBe('boundaryEvent')
    expect(boundary.eventDefinition.type).toBe('cancel')
    expect(boundary.attachedToRef).toBe('txn_1')
    expect(boundary.cancelActivity).toBe(true)
  })
})
