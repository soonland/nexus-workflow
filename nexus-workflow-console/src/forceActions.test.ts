import { describe, it, expect } from 'vitest'
import type { InstanceToken } from './api/types'
import { describeForcedAction, forceChoices } from './forceActions'

const token = (overrides: Partial<InstanceToken>): InstanceToken => ({ id: 't', elementId: 'x', elementType: 'serviceTask', status: 'waiting', ...overrides })
const actions = (t: InstanceToken) => forceChoices(t).map((c) => c.action)

describe('forceChoices', () => {
  it('a service task waiting for its worker can be completed or failed', () => {
    expect(actions(token({ elementType: 'serviceTask', waitingFor: { type: 'external' } }))).toEqual(['completeServiceTask', 'failServiceTask'])
  })

  it('a timer can be fired', () => {
    expect(actions(token({ elementType: 'intermediateCatchEvent', waitingFor: { type: 'timer' } }))).toEqual(['fireTimer'])
    expect(actions(token({ elementType: 'boundaryEvent', waitingFor: { type: 'timer' } }))).toEqual(['fireTimer'])
  })

  it('a task waiting for a person can be completed for them', () => {
    expect(actions(token({ elementType: 'userTask', waitingFor: { type: 'user-task' } }))).toEqual(['completeUserTask'])
  })

  it.each([
    ['a token that is not waiting', { status: 'active' as const, waitingFor: { type: 'external' } }],
    ['a completed token', { status: 'completed' as const, waitingFor: { type: 'external' } }],
    ['a step waiting for a message', { waitingFor: { type: 'message' } }],
    ['a step waiting for a signal', { waitingFor: { type: 'signal' } }],
    ['a waiting token that says nothing about what it waits for', {}],
    ['an external wait that is not a service task', { elementType: 'callActivity', waitingFor: { type: 'external' } }],
  ])('offers nothing for %s', (_label, overrides) => {
    expect(forceChoices(token(overrides))).toEqual([])
  })

  it('marks failing as the one that needs care', () => {
    const [complete, fail] = forceChoices(token({ waitingFor: { type: 'external' } }))
    expect(complete?.destructive).toBe(false)
    expect(fail?.destructive).toBe(true)
  })

  it('lets output variables go with completing, not with failing or firing', () => {
    const service = forceChoices(token({ waitingFor: { type: 'external' } }))
    expect(service.map((c) => c.takesVariables)).toEqual([true, false])
    expect(forceChoices(token({ waitingFor: { type: 'timer' } }))[0]?.takesVariables).toBe(false)
    expect(forceChoices(token({ elementType: 'userTask', waitingFor: { type: 'user-task' } }))[0]?.takesVariables).toBe(true)
  })
})

describe('describeForcedAction', () => {
  it('puts each action in words', () => {
    expect(describeForcedAction('completeServiceTask')).toBe('completed a service task')
    expect(describeForcedAction('failServiceTask')).toBe('failed a service task')
    expect(describeForcedAction('fireTimer')).toBe('fired a timer')
    expect(describeForcedAction('completeUserTask')).toBe('completed a task')
  })
})
