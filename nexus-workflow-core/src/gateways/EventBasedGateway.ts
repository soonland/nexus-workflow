import { DefinitionError } from '../model/errors.js'
import type { GatewayElement, ProcessDefinition, IntermediateCatchEventElement } from '../model/types.js'

const SUPPORTED_EVENT_TYPES = new Set(['message', 'signal', 'timer'])

/**
 * Validates an Event-Based Gateway's configuration at execution time.
 *
 * Throws DefinitionError if:
 * - `instantiate=true` is set (not supported)
 * - There are no outgoing sequence flows
 * - Any outgoing flow does not target an intermediateCatchEvent
 * - Any target ICE has an unsupported event definition type (only message, signal, timer allowed)
 */
export function validateEventBasedGateway(
  gateway: GatewayElement,
  definition: ProcessDefinition,
): void {
  if (gateway.instantiate) {
    throw new DefinitionError(
      `Event-Based Gateway "${gateway.id}" has instantiate=true, which is not supported. ` +
      `Only non-instantiating Event-Based Gateways are implemented.`,
    )
  }

  if (gateway.outgoingFlows.length === 0) {
    throw new DefinitionError(
      `Event-Based Gateway "${gateway.id}" has no outgoing sequence flows.`,
    )
  }

  for (const flowId of gateway.outgoingFlows) {
    const flow = definition.sequenceFlows.find(f => f.id === flowId)
    if (!flow) {
      throw new DefinitionError(
        `Event-Based Gateway "${gateway.id}" references unknown sequence flow "${flowId}".`,
      )
    }
    const target = definition.elements.find(e => e.id === flow.targetRef)
    if (!target || target.type !== 'intermediateCatchEvent') {
      throw new DefinitionError(
        `Event-Based Gateway "${gateway.id}" outgoing flow "${flowId}" must target an ` +
        `intermediateCatchEvent, but targets "${target?.type ?? 'unknown'}" (id: "${flow.targetRef}").`,
      )
    }
    const ice = target as IntermediateCatchEventElement
    if (!SUPPORTED_EVENT_TYPES.has(ice.eventDefinition.type)) {
      throw new DefinitionError(
        `Event-Based Gateway "${gateway.id}": outgoing flow "${flowId}" targets ICE ` +
        `"${ice.id}" with unsupported event definition type "${ice.eventDefinition.type}". ` +
        `Only message, signal, and timer are supported.`,
      )
    }
  }
}
