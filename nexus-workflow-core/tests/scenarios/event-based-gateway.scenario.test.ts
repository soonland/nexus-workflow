/**
 * Event-Based Gateway — Scenario Tests
 *
 * Process: Start → EBG → (ICE message "payment_confirmed" | ICE timer PT1H) → End
 *
 * Each scenario starts a fresh process and exercises one of the competing branches.
 * The losing branch must be cancelled. Delivering the losing event after resolution
 * must have no effect.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import { execute, type EngineState } from '../../src/engine/ExecutionEngine.js'
import { parseBpmn } from '../../src/parser/BpmnXmlParser.js'
import type { GatewayElement } from '../../src/model/types.js'

// ─── Setup ────────────────────────────────────────────────────────────────────

const xml = readFileSync(
  join(import.meta.dirname, '../fixtures/bpmn/event-based-gateway.bpmn'),
  'utf-8',
)
const { definition: def, errors } = parseBpmn(xml)
if (errors.length > 0) throw new Error(`Fixture has errors: ${JSON.stringify(errors)}`)
const definition = def!

let idCounter = 0
const opts = { generateId: () => `id-${++idCounter}` }

function startProcess(): EngineState {
  idCounter = 0
  return execute(definition, { type: 'StartProcess' }, null, opts).newState
}

function waitingAt(state: EngineState, elementId: string) {
  return state.tokens.find(t => t.elementId === elementId && t.status === 'waiting')
}

// ─── Scenario 1: Message fires first ──────────────────────────────────────────

describe('Scenario: message branch wins the race', () => {
  let state: EngineState

  beforeEach(() => { state = startProcess() })

  it('spawns two waiting child tokens after EBG — one at each ICE', () => {
    const msgToken  = waitingAt(state, 'ice_message')
    const timerToken = waitingAt(state, 'ice_timer')

    expect(msgToken).toBeDefined()
    expect(timerToken).toBeDefined()
    expect(state.instance.status).toBe('active')
  })

  it('child tokens share the same parentTokenId (pointing to the consumed EBG token)', () => {
    const msgToken   = waitingAt(state, 'ice_message')!
    const timerToken = waitingAt(state, 'ice_timer')!

    expect(msgToken.parentTokenId).toBeDefined()
    expect(timerToken.parentTokenId).toBeDefined()
    expect(msgToken.parentTokenId).toBe(timerToken.parentTokenId)
  })

  it('routes to the message end event and cancels the timer branch', () => {
    const { newState, events } = execute(
      definition,
      { type: 'DeliverMessage', messageName: 'payment_confirmed' },
      state, opts,
    )

    expect(newState.instance.status).toBe('completed')

    // The message token advanced and the instance completed via end_message
    const timerToken = newState.tokens.find(t => t.elementId === 'ice_timer')
    expect(timerToken?.status).toBe('cancelled')

    // A TokenCancelled event must have been emitted for the timer branch
    const cancelledEvents = events.filter(e => e.type === 'TokenCancelled')
    expect(cancelledEvents.length).toBeGreaterThanOrEqual(1)
    const timerCancelled = cancelledEvents.some(
      e => e.type === 'TokenCancelled' && e.elementId === 'ice_timer',
    )
    expect(timerCancelled).toBe(true)
  })

  it('emits EventBasedGatewayActivated with both branch element IDs', () => {
    const { events } = execute(definition, { type: 'StartProcess' }, null, opts)

    const activated = events.find(e => e.type === 'EventBasedGatewayActivated')
    expect(activated).toBeDefined()
    if (activated?.type !== 'EventBasedGatewayActivated') return
    expect(activated.elementId).toBe('ebg_1')
    expect(activated.branches).toContain('ice_message')
    expect(activated.branches).toContain('ice_timer')
    expect(activated.branches).toHaveLength(2)
  })
})

// ─── Scenario 2: Timer fires first ────────────────────────────────────────────

describe('Scenario: timer branch wins the race', () => {
  let state: EngineState

  beforeEach(() => { state = startProcess() })

  it('routes to the timer end event and cancels the message branch', () => {
    const timerToken = waitingAt(state, 'ice_timer')!

    const { newState, events } = execute(
      definition,
      { type: 'FireTimer', tokenId: timerToken.id },
      state, opts,
    )

    expect(newState.instance.status).toBe('completed')

    // The message ICE token must be cancelled
    const msgToken = newState.tokens.find(t => t.elementId === 'ice_message')
    expect(msgToken?.status).toBe('cancelled')

    // A TokenCancelled event for the message branch
    const cancelledEvents = events.filter(e => e.type === 'TokenCancelled')
    const msgCancelled = cancelledEvents.some(
      e => e.type === 'TokenCancelled' && e.elementId === 'ice_message',
    )
    expect(msgCancelled).toBe(true)
  })

  it('does not emit TokenCancelled for the winning token itself', () => {
    const timerToken = waitingAt(state, 'ice_timer')!

    const { newState, events } = execute(
      definition,
      { type: 'FireTimer', tokenId: timerToken.id },
      state, opts,
    )

    const cancelledEvents = events.filter(e => e.type === 'TokenCancelled')
    const timerCancelled = cancelledEvents.some(
      e => e.type === 'TokenCancelled' && e.elementId === 'ice_timer',
    )
    expect(timerCancelled).toBe(false)

    // The timer token itself ends up completed (advanced through the process)
    const timerTokenFinal = newState.tokens.find(t => t.id === timerToken.id)
    expect(timerTokenFinal?.status).toBe('completed')
  })
})

// ─── Scenario 3: Delivering the losing event after resolution is a no-op ──────

describe('Scenario: delivering the losing event after resolution has no effect', () => {
  it('delivering the message after the timer won leaves the instance completed', () => {
    let state = startProcess()
    const timerToken = waitingAt(state, 'ice_timer')!

    // Timer wins
    ;({ newState: state } = execute(
      definition,
      { type: 'FireTimer', tokenId: timerToken.id },
      state, opts,
    ))
    expect(state.instance.status).toBe('completed')

    // Now deliver the losing message — must be a no-op
    const { newState: stateAfter } = execute(
      definition,
      { type: 'DeliverMessage', messageName: 'payment_confirmed' },
      state, opts,
    )

    // Instance remains completed, no state change
    expect(stateAfter.instance.status).toBe('completed')
    const msgToken = stateAfter.tokens.find(t => t.elementId === 'ice_message')
    expect(msgToken?.status).toBe('cancelled')
  })

  it('firing the losing timer after the message won leaves the instance completed', () => {
    let state = startProcess()
    const timerToken = waitingAt(state, 'ice_timer')!

    // Message wins first
    ;({ newState: state } = execute(
      definition,
      { type: 'DeliverMessage', messageName: 'payment_confirmed' },
      state, opts,
    ))
    expect(state.instance.status).toBe('completed')

    // Attempt to fire the already-cancelled timer token — must throw (token is cancelled, not waiting)
    expect(() =>
      execute(definition, { type: 'FireTimer', tokenId: timerToken.id }, state, opts),
    ).toThrow()
  })
})

// ─── BPMN Parser: instantiate=true guard ──────────────────────────────────────

describe('BPMN parser — instantiate attribute', () => {
  it('parses instantiate=true on eventBasedGateway into the element', () => {
    const instantiateXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Def1" targetNamespace="http://example.com">
  <bpmn:process id="proc_inst" isExecutable="true">
    <bpmn:startEvent id="start_1">
      <bpmn:outgoing>flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:eventBasedGateway id="ebg_inst" instantiate="true">
      <bpmn:incoming>flow_1</bpmn:incoming>
      <bpmn:outgoing>flow_2</bpmn:outgoing>
    </bpmn:eventBasedGateway>
    <bpmn:endEvent id="end_1">
      <bpmn:incoming>flow_2</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="flow_1" sourceRef="start_1"  targetRef="ebg_inst"/>
    <bpmn:sequenceFlow id="flow_2" sourceRef="ebg_inst" targetRef="end_1"/>
  </bpmn:process>
</bpmn:definitions>`

    const { definition: d } = parseBpmn(instantiateXml)
    const ebg = d!.elements.find(e => e.id === 'ebg_inst') as GatewayElement
    expect(ebg.instantiate).toBe(true)
  })
})
