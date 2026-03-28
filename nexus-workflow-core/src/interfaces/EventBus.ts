import type { BpmnElementType, WaitCondition } from '../model/types.js'

// ─── Execution Events ─────────────────────────────────────────────────────────

export type ExecutionEvent =
  | { type: 'ProcessInstanceStarted'; instanceId: string; definitionId: string; definitionVersion: number }
  | { type: 'ProcessInstanceCompleted'; instanceId: string; durationMs: number }
  | { type: 'ProcessInstanceTerminated'; instanceId: string; reason: string }
  | { type: 'ProcessInstanceRestarted'; instanceId: string; restartedFromId: string }
  | { type: 'ProcessInstanceSuspended'; instanceId: string }
  | { type: 'ProcessInstanceResumed'; instanceId: string }
  | { type: 'ProcessInstanceFaulted'; instanceId: string; errorCode: string; message: string }
  | { type: 'TokenMoved'; instanceId: string; tokenId: string; fromElementId: string; toElementId: string; toElementType: BpmnElementType }
  | { type: 'TokenWaiting'; instanceId: string; tokenId: string; elementId: string; waitingFor: WaitCondition }
  | { type: 'TokenCancelled'; instanceId: string; tokenId: string; elementId: string }
  | { type: 'UserTaskCreated'; taskId: string; instanceId: string; elementId: string; name: string }
  | { type: 'UserTaskClaimed'; taskId: string; claimedBy: string }
  | { type: 'UserTaskReleased'; taskId: string }
  | { type: 'UserTaskCompleted'; taskId: string; completedBy: string }
  | { type: 'UserTaskCancelled'; taskId: string }
  | { type: 'ServiceTaskStarted'; instanceId: string; tokenId: string; elementId: string; taskType: string }
  | { type: 'ServiceTaskCompleted'; instanceId: string; tokenId: string; elementId: string; durationMs: number }
  | { type: 'ServiceTaskFailed'; instanceId: string; tokenId: string; elementId: string; error: string; attempt: number }
  | { type: 'MessageDelivered'; messageName: string; instanceId: string; tokenId: string }
  | { type: 'SignalBroadcast'; signalName: string; instanceCount: number }
  | { type: 'ErrorThrown'; instanceId: string; tokenId: string; errorCode: string; caught: boolean }
  | { type: 'TimerFired'; instanceId: string; tokenId: string; timerId: string }
  | { type: 'BoundaryEventTriggered'; instanceId: string; tokenId: string; boundaryEventId: string; interrupting: boolean }
  | { type: 'CallActivityStarted'; instanceId: string; tokenId: string; childInstanceId: string }
  | { type: 'CallActivityCompleted'; instanceId: string; tokenId: string; childInstanceId: string }
  | { type: 'EventBasedGatewayActivated'; instanceId: string; tokenId: string; elementId: string; branches: string[] }
  | { type: 'MultiInstanceStarted'; instanceId: string; tokenId: string; elementId: string; count: number; isSequential: boolean }
  | { type: 'MultiInstanceCompleted'; instanceId: string; tokenId: string; elementId: string; iterationsRan: number }
  | { type: 'CompensationTriggered'; instanceId: string; tokenId: string; elementId: string; targetActivityId?: string; handlersStarted: string[] }
  | { type: 'CompensationCompleted'; instanceId: string; tokenId: string; elementId: string }

export type ExecutionEventType = ExecutionEvent['type']

export type ExecutionEventHandler = (event: ExecutionEvent) => void | Promise<void>

export type Unsubscribe = () => void

// ─── Event Bus Interface ──────────────────────────────────────────────────────

export interface EventBus {
  publish(event: ExecutionEvent): Promise<void>
  publishMany(events: ExecutionEvent[]): Promise<void>
  subscribe(handler: ExecutionEventHandler): Unsubscribe
  subscribeToType<T extends ExecutionEventType>(
    type: T,
    handler: (event: Extract<ExecutionEvent, { type: T }>) => void | Promise<void>
  ): Unsubscribe
}
