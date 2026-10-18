import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ConcurrentModificationError } from 'nexus-workflow-core'

/** How many times a background actor re-loads and retries a cycle that lost a race. */
export const MAX_COMMIT_ATTEMPTS = 5

/**
 * Error handler for routers that load an instance, run the engine and write the result back.
 * If the instance was changed by someone else in between, the write is refused (optimistic
 * concurrency) and the caller gets 409 so it can reload and try again. Every other error is
 * handled exactly as Hono would have handled it.
 */
export function conflictAwareErrorHandler(err: Error, c: Context): Response | Promise<Response> {
  if (err instanceof ConcurrentModificationError) {
    return c.json(
      {
        error: 'CONFLICT',
        message: 'The instance was changed by someone else while this request was being handled. Reload it to see where it is now, then retry.',
        instanceId: err.instanceId,
      },
      409,
    )
  }
  if (err instanceof HTTPException) return err.getResponse()
  console.error(err)
  return c.text('Internal Server Error', 500)
}
