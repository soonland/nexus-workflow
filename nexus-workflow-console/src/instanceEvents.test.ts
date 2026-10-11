import { describe, it, expect } from 'vitest'
import type { HistoryEntry, InstanceEvent, InstanceToken } from './api/types'
import { describeEvent, describeInstanceError, historyMarks, progressMarks } from './instanceEvents'

const event = (type: string, data: Record<string, unknown> = {}): InstanceEvent => ({ id: type, type, occurredAt: '2026-01-04T00:00:00.000Z', data })
const token = (elementId: string): InstanceToken => ({ id: elementId, elementId, elementType: 'userTask', status: 'active' })

describe('describeEvent: forced steps', () => {
  it('says who pushed what along, for whom and why, and which element', () => {
    const forced = event('StepForced', { forcedBy: 'manager@example.com', action: 'completeUserTask', onBehalfOf: 'ada@example.com', reason: 'Ada is on leave', elementId: 'review' })

    expect(describeEvent(forced)).toEqual({ summary: 'manager@example.com completed a task for ada@example.com: “Ada is on leave”', elementId: 'review' })
  })

  it('copes with a bare event', () => {
    expect(describeEvent(event('StepForced', {})).summary).toBe('Someone pushed a step along')
  })
})

describe('describeEvent', () => {
  it('puts the common events in words, with the element they are about', () => {
    expect(describeEvent(event('ProcessInstanceStarted'))).toEqual({ summary: 'Instance started' })
    expect(describeEvent(event('TokenMoved', { fromElementId: 'a', toElementId: 'b' }))).toEqual({ summary: 'Moved from a to b', elementId: 'b' })
    expect(describeEvent(event('TokenWaiting', { elementId: 'review' }))).toEqual({ summary: 'Waiting', elementId: 'review' })
    expect(describeEvent(event('UserTaskCreated', { elementId: 'review', name: 'Review timesheet' }))).toEqual({
      summary: 'Task "Review timesheet" created',
      elementId: 'review',
    })
    expect(describeEvent(event('UserTaskClaimed', { claimedBy: 'ada@example.com' })).summary).toBe('Task claimed by ada@example.com')
    expect(describeEvent(event('UserTaskCompleted', { completedBy: 'ada@example.com' })).summary).toBe('Task completed by ada@example.com')
    expect(describeEvent(event('ServiceTaskFailed', { elementId: 'notify', error: 'smtp down' }))).toEqual({
      summary: 'Service task failed: smtp down',
      elementId: 'notify',
    })
    expect(describeEvent(event('ProcessInstanceTerminated', { reason: 'cancelled by operator' })).summary).toBe('Instance cancelled (cancelled by operator)')
  })

  it('falls back to the event type for events it does not know', () => {
    expect(describeEvent(event('SomethingNew', { elementId: 'x' }))).toEqual({ summary: 'SomethingNew', elementId: 'x' })
    expect(describeEvent(event('SomethingNew'))).toEqual({ summary: 'SomethingNew' })
  })

  it('copes with missing fields', () => {
    expect(describeEvent(event('TokenMoved')).summary).toBe('Moved from ? to ?')
    expect(describeEvent(event('ProcessInstanceFaulted')).summary).toBe('Instance failed: unknown error')
  })
})

describe('progressMarks', () => {
  it('marks where the instance is, where it has been and where it failed', () => {
    const marks = progressMarks(
      [
        event('TokenMoved', { fromElementId: 'start', toElementId: 'check' }),
        event('TokenMoved', { fromElementId: 'check', toElementId: 'notify' }),
        event('ServiceTaskFailed', { elementId: 'notify' }),
        event('TokenMoved', { fromElementId: 'notify', toElementId: 'review' }),
      ],
      [token('review')],
    )

    expect(marks.activeIds).toEqual(['review'])
    expect(marks.doneIds).toEqual(['start', 'check']) // "notify" failed, so it is not "passed"
    expect(marks.errorIds).toEqual(['notify'])
  })

  it('does not call an element passed while the instance is still there', () => {
    const marks = progressMarks([event('TokenMoved', { fromElementId: 'check', toElementId: 'check' })], [token('check')])
    expect(marks.doneIds).toEqual([])
  })

  it('marks cancelled tokens as failed, and lists each element once', () => {
    const marks = progressMarks(
      [event('TokenMoved', { fromElementId: 'a', toElementId: 'b' }), event('TokenMoved', { fromElementId: 'a', toElementId: 'c' }), event('TokenCancelled', { elementId: 'b' })],
      [],
    )

    expect(marks.doneIds).toEqual(['a'])
    expect(marks.errorIds).toEqual(['b'])
  })

  it('has nothing to mark without events or tokens', () => {
    expect(progressMarks([], [])).toEqual({ activeIds: [], doneIds: [], errorIds: [] })
  })
})

describe('historyMarks', () => {
  const step = (elementId: string, status: HistoryEntry['status']): HistoryEntry => ({
    id: `${elementId}-${status}`,
    elementId,
    elementType: 'userTask',
    status,
    startedAt: '2026-01-04T00:00:00.000Z',
    completedAt: '2026-01-04T00:00:01.000Z',
  })

  it('marks where the instance is, the steps it finished, and the ones that were cancelled or failed', () => {
    const marks = historyMarks([step('start', 'completed'), step('check', 'completed'), step('notify', 'error'), step('wait', 'cancelled')], [token('review')])

    expect(marks).toEqual({ activeIds: ['review'], doneIds: ['start', 'check'], errorIds: ['notify', 'wait'] })
  })

  it('does not call an element passed while the instance is there, or one that also failed once', () => {
    const marks = historyMarks([step('loop', 'completed'), step('loop', 'error'), step('now', 'completed')], [token('now')])

    expect(marks.doneIds).toEqual([])
    expect(marks.errorIds).toEqual(['loop'])
  })

  it('has nothing to mark without steps or tokens', () => {
    expect(historyMarks([], [])).toEqual({ activeIds: [], doneIds: [], errorIds: [] })
  })
})

describe('describeInstanceError', () => {
  it('says what, and where', () => {
    expect(describeInstanceError({ code: 'HANDLER_NOT_FOUND', message: "No handler registered for task type 'send-email'", elementId: 'send' })).toBe(
      "HANDLER_NOT_FOUND: No handler registered for task type 'send-email' (at send)",
    )
  })

  it('copes with whichever parts are missing', () => {
    expect(describeInstanceError({ message: 'test' })).toBe('test')
    expect(describeInstanceError({ code: 'FORCED_FAILURE', elementId: 'send' })).toBe('FORCED_FAILURE (at send)')
    expect(describeInstanceError({})).toBe('An error')
  })
})
