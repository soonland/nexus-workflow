import type { VariableValue } from '../model/types.js'

export interface TaskContext {
  instanceId: string
  tokenId: string
  elementId: string
  taskType: string
  attempt: number
  variables: Readonly<Record<string, VariableValue>>
}

export interface TaskError {
  code: string
  message: string
}

export interface TaskResult {
  status: 'completed' | 'error' | 'retry'
  outputVariables?: Record<string, VariableValue>
  error?: TaskError
  /** Delay before retry in ms. Only meaningful when status is 'retry'. */
  retryDelay?: number
}

export interface ServiceTaskHandler {
  /** The task type identifier this handler is responsible for. */
  readonly taskType: string

  execute(context: TaskContext): Promise<TaskResult>
}
