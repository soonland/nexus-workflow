import { describe, it, expect } from 'vitest'
import { DefinitionError } from '../model/errors.js'
import type {
  GatewayElement,
  ProcessDefinition,
  IntermediateCatchEventElement,
  EndEventElement,
  StartEventElement,
  ServiceTaskElement,
} from '../model/types.js'
import { validateEventBasedGateway } from './EventBasedGateway.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDefinition(
  gateway: GatewayElement,
  extraElements: (IntermediateCatchEventElement | EndEventElement | StartEventElement | ServiceTaskElement)[] = [],
  extraFlows: { id: string; sourceRef: string; targetRef: string }[] = [],
): ProcessDefinition {
  return {
    id: 'proc-1',
    version: 1,
    elements: [gateway, ...extraElements],
    sequenceFlows: extraFlows,
    startEventId: 'start_1',
    deployedAt: new Date(),
    isDeployable: true,
  }
}

function makeGateway(overrides: Partial<GatewayElement> = {}): GatewayElement {
  return {
    id: 'ebg_1',
    type: 'eventBasedGateway',
    incomingFlows: ['flow_in'],
    outgoingFlows: ['flow_msg', 'flow_sig'],
    ...overrides,
  }
}

function makeMessageIce(id = 'ice_msg', messageName = 'my_message'): IntermediateCatchEventElement {
  return {
    id,
    type: 'intermediateCatchEvent',
    incomingFlows: [],
    outgoingFlows: [],
    eventDefinition: { type: 'message', messageName },
  }
}

function makeSignalIce(id = 'ice_sig', signalName = 'my_signal'): IntermediateCatchEventElement {
  return {
    id,
    type: 'intermediateCatchEvent',
    incomingFlows: [],
    outgoingFlows: [],
    eventDefinition: { type: 'signal', signalName },
  }
}

function makeTimerIce(id = 'ice_timer'): IntermediateCatchEventElement {
  return {
    id,
    type: 'intermediateCatchEvent',
    incomingFlows: [],
    outgoingFlows: [],
    eventDefinition: { type: 'timer', timerExpression: 'PT1H' },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EventBasedGateway — validateEventBasedGateway', () => {
  it('passes for a valid gateway with message and signal ICE targets', () => {
    const gateway = makeGateway()
    const definition = makeDefinition(
      gateway,
      [makeMessageIce('ice_msg'), makeSignalIce('ice_sig')],
      [
        { id: 'flow_msg', sourceRef: 'ebg_1', targetRef: 'ice_msg' },
        { id: 'flow_sig', sourceRef: 'ebg_1', targetRef: 'ice_sig' },
      ],
    )
    expect(() => validateEventBasedGateway(gateway, definition)).not.toThrow()
  })

  it('passes for a valid gateway with message and timer ICE targets', () => {
    const gateway = makeGateway({ outgoingFlows: ['flow_msg', 'flow_timer'] })
    const definition = makeDefinition(
      gateway,
      [makeMessageIce(), makeTimerIce()],
      [
        { id: 'flow_msg',   sourceRef: 'ebg_1', targetRef: 'ice_msg' },
        { id: 'flow_timer', sourceRef: 'ebg_1', targetRef: 'ice_timer' },
      ],
    )
    expect(() => validateEventBasedGateway(gateway, definition)).not.toThrow()
  })

  it('throws DefinitionError when instantiate=true', () => {
    const gateway = makeGateway({ instantiate: true })
    const definition = makeDefinition(
      gateway,
      [makeMessageIce()],
      [{ id: 'flow_msg', sourceRef: 'ebg_1', targetRef: 'ice_msg' }],
    )
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow(DefinitionError)
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow('instantiate=true')
  })

  it('throws DefinitionError when there are no outgoing flows', () => {
    const gateway = makeGateway({ outgoingFlows: [] })
    const definition = makeDefinition(gateway)
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow(DefinitionError)
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow('no outgoing sequence flows')
  })

  it('throws DefinitionError when an outgoing flow references an unknown sequence flow', () => {
    const gateway = makeGateway({ outgoingFlows: ['flow_missing'] })
    const definition = makeDefinition(gateway, [], [])
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow(DefinitionError)
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow('"flow_missing"')
  })

  it('throws DefinitionError when an outgoing flow targets a non-ICE element (serviceTask)', () => {
    const gateway = makeGateway({ outgoingFlows: ['flow_task'] })
    const task: ServiceTaskElement = {
      id: 'task_1',
      type: 'serviceTask',
      incomingFlows: [],
      outgoingFlows: [],
    }
    const definition = makeDefinition(
      gateway,
      [task],
      [{ id: 'flow_task', sourceRef: 'ebg_1', targetRef: 'task_1' }],
    )
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow(DefinitionError)
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow('intermediateCatchEvent')
  })

  it('throws DefinitionError when an outgoing flow targets a non-ICE element (endEvent)', () => {
    const gateway = makeGateway({ outgoingFlows: ['flow_end'] })
    const end: EndEventElement = {
      id: 'end_1',
      type: 'endEvent',
      eventDefinition: { type: 'none' },
      incomingFlows: [],
      outgoingFlows: [],
    }
    const definition = makeDefinition(
      gateway,
      [end],
      [{ id: 'flow_end', sourceRef: 'ebg_1', targetRef: 'end_1' }],
    )
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow(DefinitionError)
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow('intermediateCatchEvent')
  })

  it('throws DefinitionError when a target ICE has an unsupported event type (error)', () => {
    const gateway = makeGateway({ outgoingFlows: ['flow_error_ice'] })
    const errorIce: IntermediateCatchEventElement = {
      id: 'ice_error',
      type: 'intermediateCatchEvent',
      incomingFlows: [],
      outgoingFlows: [],
      eventDefinition: { type: 'error', errorCode: 'ERR_1' },
    }
    const definition = makeDefinition(
      gateway,
      [errorIce],
      [{ id: 'flow_error_ice', sourceRef: 'ebg_1', targetRef: 'ice_error' }],
    )
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow(DefinitionError)
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow('"error"')
  })

  it('throws DefinitionError when a target ICE has an unsupported event type (conditional)', () => {
    const gateway = makeGateway({ outgoingFlows: ['flow_cond'] })
    const condIce: IntermediateCatchEventElement = {
      id: 'ice_cond',
      type: 'intermediateCatchEvent',
      incomingFlows: [],
      outgoingFlows: [],
      eventDefinition: { type: 'conditional' },
    }
    const definition = makeDefinition(
      gateway,
      [condIce],
      [{ id: 'flow_cond', sourceRef: 'ebg_1', targetRef: 'ice_cond' }],
    )
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow(DefinitionError)
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow('"conditional"')
  })

  it('throws DefinitionError when a target element does not exist in the definition', () => {
    const gateway = makeGateway({ outgoingFlows: ['flow_ghost'] })
    const definition = makeDefinition(
      gateway,
      [],
      [{ id: 'flow_ghost', sourceRef: 'ebg_1', targetRef: 'nonexistent' }],
    )
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow(DefinitionError)
    expect(() => validateEventBasedGateway(gateway, definition)).toThrow('intermediateCatchEvent')
  })

  it('passes for a single-branch gateway (degenerate, but valid)', () => {
    const gateway = makeGateway({ outgoingFlows: ['flow_msg'] })
    const definition = makeDefinition(
      gateway,
      [makeMessageIce()],
      [{ id: 'flow_msg', sourceRef: 'ebg_1', targetRef: 'ice_msg' }],
    )
    expect(() => validateEventBasedGateway(gateway, definition)).not.toThrow()
  })
})
