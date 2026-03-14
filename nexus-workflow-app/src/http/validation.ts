import { z } from 'zod'

// ─── Error Helper ─────────────────────────────────────────────────────────────

export function validationError(error: z.ZodError) {
  return { error: 'VALIDATION_ERROR' as const, issues: error.flatten() }
}

// ─── Shared ───────────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().nonnegative().default(0),
  pageSize: z.coerce.number().int().positive().default(20),
})

// ─── Instances ────────────────────────────────────────────────────────────────

export const startInstanceBodySchema = z.object({
  variables: z.record(z.string(), z.unknown()).optional(),
  correlationKey: z.string().optional(),
  businessKey: z.string().optional(),
})

export const INSTANCE_STATUS_VALUES = ['pending', 'active', 'suspended', 'completed', 'terminated'] as const
export const instanceStatusSchema = z.enum(INSTANCE_STATUS_VALUES)

export const listInstancesQuerySchema = paginationSchema.extend({
  definitionId: z.string().optional(),
  correlationKey: z.string().optional(),
  businessKey: z.string().optional(),
  status: z.string().optional(),
  startedAfter: z.string().optional(),
  startedBefore: z.string().optional(),
})

export const COMMAND_TYPES = [
  'CompleteServiceTask', 'FailServiceTask', 'CompleteUserTask',
  'FireTimer', 'DeliverMessage', 'BroadcastSignal',
  'SuspendInstance', 'ResumeInstance', 'CancelInstance',
] as const

export const commandBodySchema = z.object({
  type: z.enum(COMMAND_TYPES),
}).passthrough()

// ─── Tasks ────────────────────────────────────────────────────────────────────

export const USER_TASK_STATUS_VALUES = ['open', 'claimed', 'completed', 'cancelled'] as const
export const userTaskStatusSchema = z.enum(USER_TASK_STATUS_VALUES)

export const listTasksQuerySchema = paginationSchema.extend({
  instanceId: z.string().optional(),
  assignee: z.string().optional(),
  candidateGroup: z.string().optional(),
  status: userTaskStatusSchema.optional(),
})

export const completeTaskBodySchema = z.object({
  completedBy: z.string().min(1),
  outputVariables: z.record(z.string(), z.unknown()).optional(),
})

export const claimTaskBodySchema = z.object({
  claimedBy: z.string().min(1),
})

// ─── Events ───────────────────────────────────────────────────────────────────

export const deliverMessageBodySchema = z.object({
  messageName: z.string().min(1),
  correlationValue: z.string().optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
})

export const broadcastSignalBodySchema = z.object({
  signalName: z.string().min(1),
  variables: z.record(z.string(), z.unknown()).optional(),
})

// ─── Definitions ──────────────────────────────────────────────────────────────

export const versionQuerySchema = z.object({
  version: z.coerce.number().int().positive().optional(),
})
