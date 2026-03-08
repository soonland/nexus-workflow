import type { Token, TokenStatus, BpmnElementType, WaitCondition } from '../../../src/model/types.js'

const DEFAULT_DATE = new Date('2026-01-01T00:00:00.000Z')

export function buildToken(overrides: Partial<Token> = {}): Token {
  return {
    id: 'tok-1',
    instanceId: 'inst-1',
    elementId: 'start_1',
    elementType: 'startEvent' as BpmnElementType,
    status: 'active' as TokenStatus,
    scopeId: 'scope-1',
    createdAt: DEFAULT_DATE,
    updatedAt: DEFAULT_DATE,
    ...overrides,
  }
}

export function buildWaitingToken(
  waitingFor: WaitCondition,
  overrides: Partial<Token> = {},
): Token {
  return buildToken({
    status: 'waiting',
    waitingFor,
    ...overrides,
  })
}

export function buildTokenAt(elementId: string, elementType: BpmnElementType, overrides: Partial<Token> = {}): Token {
  return buildToken({ elementId, elementType, ...overrides })
}
