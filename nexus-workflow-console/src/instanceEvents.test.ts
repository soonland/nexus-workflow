import { describe, it, expect } from 'vitest'
import type { InstanceEvent, InstanceToken } from './api/types'
import { describeEvent, progressMarks } from './instanceEvents'

const event = (type: string, data: Record<string, unknown> = {}): InstanceEvent => ({ id: type, type, occurredAt: '2026-01-04T00:00:00.000Z', data })
const token = (elementId: string): InstanceToken => ({ id: elementId, elementId, elementType: 'userTask', status: 'active' })

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
