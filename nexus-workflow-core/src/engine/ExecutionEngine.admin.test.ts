import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { parseBpmn } from '../parser/BpmnXmlParser.js'
import { execute } from './ExecutionEngine.js'
import type { EngineState } from './ExecutionEngine.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fixtureDir = join(import.meta.dirname, '../../tests/fixtures/bpmn')

function loadDef(name: string) {
  const xml = readFileSync(join(fixtureDir, name), 'utf-8')
  const { definition, errors } = parseBpmn(xml)
  if (errors.length > 0) throw new Error(`Fixture "${name}" has errors: ${JSON.stringify(errors)}`)
  return definition!
}

let idCounter = 0
const opts = { generateId: () => `id-${++idCounter}` }

function start(fixture: string): { state: EngineState; def: ReturnType<typeof loadDef> } {
  idCounter = 0
  const def = loadDef(fixture)
  const { newState } = execute(def, { type: 'StartProcess' }, null, opts)
  return { state: newState, def }
}

// ─── Error boundary events ────────────────────────────────────────────────────

describe('ExecutionEngine — error boundary events', () => {
  it('routes through the error boundary when FailServiceTask error code matches', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const taskToken = s0.tokens.find(t => t.elementId === 'task_notify')!

    const { newState } = execute(
      def,
      { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'NOTIFY_FAILED', message: 'SendGrid down' } },
      s0,
      opts,
    )

    // Task token is cancelled, process routes to task_log (next service task)
    expect(newState.tokens.find(t => t.elementId === 'task_notify')!.status).toBe('cancelled')
    const logToken = newState.tokens.find(t => t.elementId === 'task_log')
    expect(logToken?.status).toBe('waiting')
  })

  it('process does not fault when error boundary catches the error', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const taskToken = s0.tokens.find(t => t.elementId === 'task_notify')!

    const { newState } = execute(
      def,
      { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'NOTIFY_FAILED', message: 'SendGrid down' } },
      s0,
      opts,
    )

    expect(newState.instance.status).toBe('active')
  })

  it('completes via the error boundary path after the fallback task finishes', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const taskToken = s0.tokens.find(t => t.elementId === 'task_notify')!

    const { newState: s1 } = execute(
      def,
      { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'NOTIFY_FAILED', message: 'SendGrid down' } },
      s0,
      opts,
    )

    const logToken = s1.tokens.find(t => t.elementId === 'task_log')!
    const { newState: s2 } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: logToken.id },
      s1,
      opts,
    )

    expect(s2.instance.status).toBe('completed')
    expect(s2.tokens.find(t => t.elementId === 'end_logged')?.status).toBe('completed')
  })

  it('cancels the sibling timer boundary token when the error boundary fires', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const taskToken = s0.tokens.find(t => t.elementId === 'task_notify')!
    const boundaryToken = s0.tokens.find(t => t.elementId === 'boundary_error')!

    const { newState } = execute(
      def,
      { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'NOTIFY_FAILED', message: 'down' } },
      s0,
      opts,
    )

    expect(newState.tokens.find(t => t.id === boundaryToken.id)?.status).toBe('cancelled')
  })

  it('routes through a catch-all error boundary when errorCode does not match named boundary', () => {
    // Inline process: serviceTask with a catch-all boundary (no errorCode)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="x">
      <bpmn:process id="proc_1" isExecutable="true">
        <bpmn:startEvent id="start_1"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
        <bpmn:serviceTask id="task_1"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:serviceTask>
        <bpmn:boundaryEvent id="boundary_1" attachedToRef="task_1" cancelActivity="true">
          <bpmn:outgoing>f3</bpmn:outgoing>
          <bpmn:errorEventDefinition/>
        </bpmn:boundaryEvent>
        <bpmn:endEvent id="end_ok"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
        <bpmn:endEvent id="end_err"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
        <bpmn:sequenceFlow id="f1" sourceRef="start_1" targetRef="task_1"/>
        <bpmn:sequenceFlow id="f2" sourceRef="task_1" targetRef="end_ok"/>
        <bpmn:sequenceFlow id="f3" sourceRef="boundary_1" targetRef="end_err"/>
      </bpmn:process>
    </bpmn:definitions>`
    const { definition: def } = parseBpmn(xml)
    const { newState: s0 } = execute(def!, { type: 'StartProcess' }, null, opts)
    const taskToken = s0.tokens.find(t => t.elementId === 'task_1')!

    const { newState } = execute(
      def!,
      { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'ANYTHING', message: 'whatever' } },
      s0,
      opts,
    )

    expect(newState.instance.status).toBe('completed')
    expect(newState.tokens.find(t => t.elementId === 'end_err')?.status).toBe('completed')
  })

  it('suspends the instance when no error boundary matches', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const taskToken = s0.tokens.find(t => t.elementId === 'task_notify')!

    const { newState } = execute(
      def,
      { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'UNMATCHED_CODE', message: 'unknown' } },
      s0,
      opts,
    )

    expect(newState.instance.status).toBe('suspended')
  })

  it('stores error info on the suspended instance', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const taskToken = s0.tokens.find(t => t.elementId === 'task_notify')!

    const { newState } = execute(
      def,
      { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'UNMATCHED_CODE', message: 'unknown error' } },
      s0,
      opts,
    )

    expect(newState.instance.errorInfo?.code).toBe('UNMATCHED_CODE')
    expect(newState.instance.errorInfo?.message).toBe('unknown error')
  })

  it('keeps the task token waiting when the instance is suspended', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const taskToken = s0.tokens.find(t => t.elementId === 'task_notify')!

    const { newState } = execute(
      def,
      { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'UNMATCHED_CODE', message: 'unknown' } },
      s0,
      opts,
    )

    expect(newState.tokens.find(t => t.elementId === 'task_notify')?.status).toBe('waiting')
  })
})

// ─── Admin: skip (force complete) a suspended task ────────────────────────────

describe('ExecutionEngine — admin: skip suspended task', () => {
  it('CompleteServiceTask on a suspended instance resumes the instance', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const taskToken = s0.tokens.find(t => t.elementId === 'task_notify')!

    const { newState: suspended } = execute(
      def,
      { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'UNMATCHED_CODE', message: 'x' } },
      s0,
      opts,
    )
    expect(suspended.instance.status).toBe('suspended')

    const { newState: resumed } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      suspended,
      opts,
    )

    expect(resumed.instance.status).toBe('completed')
  })

  it('process completes normally after admin forces the failed task through', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const taskToken = s0.tokens.find(t => t.elementId === 'task_notify')!

    const { newState: suspended } = execute(
      def,
      { type: 'FailServiceTask', tokenId: taskToken.id, error: { code: 'UNMATCHED_CODE', message: 'x' } },
      s0,
      opts,
    )

    const { newState } = execute(
      def,
      { type: 'CompleteServiceTask', tokenId: taskToken.id },
      suspended,
      opts,
    )

    expect(newState.tokens.find(t => t.elementId === 'end_ok')?.status).toBe('completed')
  })
})

// ─── Admin: explicit suspend and resume ───────────────────────────────────────

describe('ExecutionEngine — admin: SuspendInstance / ResumeInstance', () => {
  it('SuspendInstance sets instance status to suspended', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')

    const { newState } = execute(def, { type: 'SuspendInstance' }, s0, opts)
    expect(newState.instance.status).toBe('suspended')
  })

  it('SuspendInstance leaves all tokens in place', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const waitingBefore = s0.tokens.filter(t => t.status === 'waiting').length

    const { newState } = execute(def, { type: 'SuspendInstance' }, s0, opts)
    expect(newState.tokens.filter(t => t.status === 'waiting')).toHaveLength(waitingBefore)
  })

  it('ResumeInstance sets instance status back to active', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const { newState: suspended } = execute(def, { type: 'SuspendInstance' }, s0, opts)

    const { newState } = execute(def, { type: 'ResumeInstance' }, suspended, opts)
    expect(newState.instance.status).toBe('active')
  })

  it('throws when trying to suspend an already completed instance', () => {
    // Use simple-sequence which completes immediately
    const def = loadDef('simple-sequence.bpmn')
    const { newState: completed } = execute(def, { type: 'StartProcess' }, null, opts)
    expect(completed.instance.status).toBe('completed')

    expect(() => execute(def, { type: 'SuspendInstance' }, completed, opts)).toThrow()
  })

  it('throws when trying to resume a non-suspended instance', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')

    expect(() => execute(def, { type: 'ResumeInstance' }, s0, opts)).toThrow()
  })
})

// ─── Admin: cancel instance ───────────────────────────────────────────────────

describe('ExecutionEngine — admin: CancelInstance', () => {
  it('sets instance status to terminated', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')

    const { newState } = execute(def, { type: 'CancelInstance' }, s0, opts)
    expect(newState.instance.status).toBe('terminated')
  })

  it('cancels all waiting tokens', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')

    const { newState } = execute(def, { type: 'CancelInstance' }, s0, opts)
    const stillActive = newState.tokens.filter(t => t.status === 'waiting' || t.status === 'active')
    expect(stillActive).toHaveLength(0)
  })

  it('emits ProcessInstanceTerminated', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')

    const { events } = execute(def, { type: 'CancelInstance' }, s0, opts)
    expect(events.some(e => e.type === 'ProcessInstanceTerminated')).toBe(true)
  })

  it('can cancel a suspended instance', () => {
    const { state: s0, def } = start('service-task-error-boundary.bpmn')
    const { newState: suspended } = execute(def, { type: 'SuspendInstance' }, s0, opts)

    const { newState } = execute(def, { type: 'CancelInstance' }, suspended, opts)
    expect(newState.instance.status).toBe('terminated')
  })
})
