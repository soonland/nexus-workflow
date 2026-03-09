import type { ServiceTaskHandler, TaskContext, TaskResult } from 'nexus-workflow-core'

/**
 * Built-in handler for `taskType: "log"`.
 *
 * Writes a message to stdout. Always completes successfully.
 *
 * Expected input variables:
 * - `message` (string, optional) — the message to log; defaults to a generic message
 * - `level`   (string, optional) — "info" | "warn" | "error"; default "info"
 */
export class LogHandler implements ServiceTaskHandler {
  readonly taskType = 'log'

  async execute(ctx: TaskContext): Promise<TaskResult> {
    const message =
      (ctx.variables['message']?.value as string | undefined) ??
      `[nexus-workflow] service task '${ctx.elementId}' executed (instance ${ctx.instanceId})`

    const level = (ctx.variables['level']?.value as string | undefined) ?? 'info'

    if (level === 'error') {
      console.error(message)
    } else if (level === 'warn') {
      console.warn(message)
    } else {
      console.log(message)
    }

    return { status: 'completed' }
  }
}
