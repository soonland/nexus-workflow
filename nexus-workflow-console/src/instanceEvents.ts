import type { InstanceEvent, InstanceToken } from './api/types'

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

/** A short sentence for an engine event, and the element it is about (if any). */
export function describeEvent(event: InstanceEvent): { summary: string; elementId?: string } {
  const d = event.data
  const element = text(d['elementId']) ?? text(d['toElementId'])
  const at = (summary: string, elementId = element) => (elementId ? { summary, elementId } : { summary })

  switch (event.type) {
    case 'ProcessInstanceStarted':
      return { summary: 'Instance started' }
    case 'ProcessInstanceCompleted':
      return { summary: 'Instance completed' }
    case 'ProcessInstanceTerminated':
      return { summary: `Instance cancelled${text(d['reason']) ? ` (${text(d['reason'])})` : ''}` }
    case 'ProcessInstanceSuspended':
      return { summary: 'Instance suspended' }
    case 'ProcessInstanceResumed':
      return { summary: 'Instance resumed' }
    case 'ProcessInstanceFaulted':
      return { summary: `Instance failed: ${text(d['message']) ?? text(d['errorCode']) ?? 'unknown error'}` }
    case 'TokenMoved':
      return at(`Moved from ${text(d['fromElementId']) ?? '?'} to ${text(d['toElementId']) ?? '?'}`, text(d['toElementId']))
    case 'TokenWaiting':
      return at('Waiting')
    case 'TokenCancelled':
      return at('Cancelled')
    case 'UserTaskCreated':
      return at(`Task "${text(d['name']) ?? 'task'}" created`)
    case 'UserTaskClaimed':
      return { summary: `Task claimed by ${text(d['claimedBy']) ?? '?'}` }
    case 'UserTaskReleased':
      return { summary: 'Task released' }
    case 'UserTaskCompleted':
      return { summary: `Task completed by ${text(d['completedBy']) ?? '?'}` }
    case 'UserTaskCancelled':
      return { summary: 'Task cancelled' }
    case 'ServiceTaskStarted':
      return at(`Service task started${text(d['taskType']) ? ` (${text(d['taskType'])})` : ''}`)
    case 'ServiceTaskCompleted':
      return at('Service task completed')
    case 'ServiceTaskFailed':
      return at(`Service task failed: ${text(d['error']) ?? 'unknown error'}`)
    case 'ErrorThrown':
      return { summary: `Error ${text(d['errorCode']) ?? ''} ${d['caught'] === true ? 'caught' : 'not caught'}`.replace('  ', ' ') }
    case 'TimerFired':
      return { summary: 'Timer fired' }
    case 'MessageDelivered':
      return { summary: `Message "${text(d['messageName']) ?? '?'}" delivered` }
    default:
      return at(event.type)
  }
}

export interface Progress {
  /** Where the instance is now. */
  activeIds: string[]
  /** Elements it has left behind. */
  doneIds: string[]
  /** Elements where something was cancelled or failed. */
  errorIds: string[]
}

/** What to mark on the diagram, worked out from the instance's tokens and its event log. */
export function progressMarks(events: InstanceEvent[], tokens: InstanceToken[]): Progress {
  const activeIds = [...new Set(tokens.map((t) => t.elementId))]
  const left = new Set<string>()
  const failed = new Set<string>()

  for (const event of events) {
    const from = text(event.data['fromElementId'])
    if (event.type === 'TokenMoved' && from) left.add(from)
    const element = text(event.data['elementId'])
    if ((event.type === 'TokenCancelled' || event.type === 'ServiceTaskFailed') && element) failed.add(element)
  }

  return {
    activeIds,
    doneIds: [...left].filter((id) => !activeIds.includes(id) && !failed.has(id)),
    errorIds: [...failed],
  }
}
