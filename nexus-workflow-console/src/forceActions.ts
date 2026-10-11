import type { ForcedAction, InstanceDetail, InstanceToken } from './api/types'

export interface ForceChoice {
  action: ForcedAction
  /** The button's text. */
  label: string
  /** The dialog's title. */
  title: string
  /** What will happen, in a sentence, for the confirmation. */
  effect: string
  /** Whether the person can hand output variables to the workflow. */
  takesVariables: boolean
  destructive: boolean
}

const COMPLETE_SERVICE: ForceChoice = {
  action: 'completeServiceTask',
  label: 'Complete',
  title: 'Complete this service task by hand',
  effect: 'The step is marked as done without its worker, and the instance moves on.',
  takesVariables: true,
  destructive: false,
}
const FAIL_SERVICE: ForceChoice = {
  action: 'failServiceTask',
  label: 'Fail',
  title: 'Fail this service task by hand',
  effect: 'The step is marked as failed. If the process handles the error it follows that path; otherwise the instance is suspended.',
  takesVariables: false,
  destructive: true,
}
const FIRE_TIMER: ForceChoice = {
  action: 'fireTimer',
  label: 'Fire now',
  title: 'Fire this timer now',
  effect: 'The wait is skipped and the instance moves on as if the time had passed.',
  takesVariables: false,
  destructive: false,
}
const COMPLETE_TASK: ForceChoice = {
  action: 'completeUserTask',
  label: 'Complete as me',
  title: 'Complete this task for its assignee',
  effect: 'The task is completed in your name, on behalf of the person it was assigned to, and the instance moves on.',
  takesVariables: true,
  destructive: false,
}

/**
 * What a person may do to push this step along, or nothing: only a token that is waiting, and only in
 * the way it is waiting. This is the same rule the server enforces (it refuses the rest with 422).
 */
export function forceChoices(token: InstanceToken, instance?: Pick<InstanceDetail, 'status' | 'errorInfo'>): ForceChoice[] {
  if (token.status !== 'waiting') return []
  switch (token.waitingFor?.type) {
    case 'external': {
      if (token.elementType !== 'serviceTask') return []
      // Failing a task that has already failed here (and left the instance suspended) changes nothing:
      // it is suspended at this step already. Only completing it makes sense.
      const error = instance?.errorInfo
      const failedHere = instance?.status === 'suspended' && error !== undefined && (error.tokenId ? error.tokenId === token.id : error.elementId === token.elementId)
      return failedHere ? [COMPLETE_SERVICE] : [COMPLETE_SERVICE, FAIL_SERVICE]
    }
    case 'timer':
      return [FIRE_TIMER]
    case 'user-task':
      return [COMPLETE_TASK]
    default:
      return []
  }
}

const VERB: Record<ForcedAction, string> = {
  completeServiceTask: 'completed a service task',
  failServiceTask: 'failed a service task',
  fireTimer: 'fired a timer',
  completeUserTask: 'completed a task',
}

/** "completed a service task", for sentences about a forced step. */
export const describeForcedAction = (action: ForcedAction): string => VERB[action] ?? 'pushed a step along'

/**
 * What the person should be told once a step has been pushed along, from what the instance did next.
 * A failure is the one that is easy to misread: whether anything moved depends on the process.
 */
export function describeForceOutcome(action: ForcedAction, instanceStatus: string): string {
  if (action === 'failServiceTask') {
    return instanceStatus === 'suspended'
      ? 'The step was failed. Nothing in this process handles that error, so the instance is suspended here: you can still complete the step.'
      : 'The step was failed and the process handled the error: the instance moved on.'
  }
  return 'The step was pushed along'
}
