import { Hono } from 'hono'
import { execute, RuntimeError, type EngineCommand, type EventBus, type ExecutionEvent, type ForcedAction, type StateStore, type Token } from 'nexus-workflow-core'
import { auditActorOf } from '../auth/auditActor.js'
import type { AuditLog } from '../db/AuditLog.js'
import { buildUserTaskCreationOps, computeStoreOps, loadEngineState, normalizeVariables } from './engineHelpers.js'
import type { AppVariables } from './middleware/auth.js'

const ACTIONS: readonly ForcedAction[] = ['completeServiceTask', 'failServiceTask', 'fireTimer', 'completeUserTask']
const MAX_REASON = 500

const invalid = (message: string) => ({ error: 'VALIDATION_ERROR', message })

/** Whether the token is waiting in the way this action can push it along. */
function fits(action: ForcedAction, token: Token): boolean {
  switch (action) {
    case 'completeServiceTask':
    case 'failServiceTask':
      return token.elementType === 'serviceTask' && token.waitingFor?.type === 'external'
    case 'fireTimer':
      return token.waitingFor?.type === 'timer'
    case 'completeUserTask':
      return token.waitingFor?.type === 'user-task'
  }
}

/**
 * POST /instances/:id/force: a person pushes a stuck step along by hand. It is the ordinary engine
 * command for the step, plus what makes it accountable:
 *  - a **reason** is required, and the person is recorded (they are a signed-in person, never a key);
 *  - the cycle also carries a `StepForced` event, so the event log, the webhooks and the step history
 *    all say it was forced, by whom and why (and, for a task, on whose behalf);
 *  - an audit log entry is written.
 * The step must still be the one the instance is waiting at; if the instance has moved on it is refused
 * (409) and nothing happens.
 */
export function createForceRouter(
  storeFactory: (tenantId: string) => StateStore,
  eventBusFor: (tenantId: string) => EventBus,
  audit?: AuditLog,
): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()

  app.post('/instances/:id/force', async (c) => {
    const principal = c.get('principal')
    if (!principal || principal.kind !== 'user') {
      return c.json({ error: 'FORBIDDEN', message: 'Forcing a step needs a signed-in person: it is recorded against them' }, 403)
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(invalid('Invalid JSON body'), 400)
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return c.json(invalid('Body must be a JSON object'), 400)
    const { action, tokenId, reason, outputVariables, error } = body as Record<string, unknown>

    if (typeof action !== 'string' || !ACTIONS.includes(action as ForcedAction)) {
      return c.json(invalid(`"action" must be one of: ${ACTIONS.join(', ')}`), 400)
    }
    if (typeof tokenId !== 'string' || tokenId === '') return c.json(invalid('"tokenId" must be a string'), 400)
    if (typeof reason !== 'string' || reason.trim() === '') return c.json(invalid('A reason is required'), 400)
    if (reason.trim().length > MAX_REASON) return c.json(invalid(`The reason must not exceed ${MAX_REASON} characters`), 400)
    if (outputVariables !== undefined && (typeof outputVariables !== 'object' || outputVariables === null || Array.isArray(outputVariables))) {
      return c.json(invalid('"outputVariables" must be a JSON object'), 400)
    }
    if (error !== undefined && (typeof error !== 'object' || error === null || Array.isArray(error))) {
      return c.json(invalid('"error" must be an object with an optional code and message'), 400)
    }

    const tenantId = c.get('tenantId')
    const store = storeFactory(tenantId)
    const instanceId = c.req.param('id')
    const forced = action as ForcedAction
    const why = reason.trim()

    const state = await loadEngineState(store, instanceId)
    if (!state) return c.json({ error: 'NOT_FOUND', message: `Instance '${instanceId}' not found` }, 404)

    const token = state.tokens.find((t) => t.id === tokenId)
    if (!token || token.status !== 'waiting') {
      return c.json({ error: 'STEP_NOT_CURRENT', message: 'That step is no longer waiting: the instance has moved on. Reload to see where it is now.' }, 409)
    }
    if (!fits(forced, token)) {
      return c.json({ error: 'WRONG_STEP_KIND', message: `"${forced}" cannot be used on the step "${token.elementId}" (${token.elementType})` }, 422)
    }

    const definition = await store.getDefinition(state.instance.definitionId, state.instance.definitionVersion)
    if (!definition) return c.json({ error: 'INTERNAL_ERROR', message: 'Definition not found' }, 500)

    // A user task also has a task record (what Tasks lists); it is finished with the step
    const task =
      forced === 'completeUserTask'
        ? (await store.queryUserTasks({ instanceId, page: 0, pageSize: 1000 })).items.find(
            (t) => t.tokenId === tokenId && (t.status === 'open' || t.status === 'claimed'),
          )
        : undefined
    const actor = principal.user.email

    let command: EngineCommand
    const output = outputVariables ? normalizeVariables(outputVariables as Record<string, unknown>) : undefined
    switch (forced) {
      case 'completeServiceTask':
        command = { type: 'CompleteServiceTask', tokenId, ...(output ? { outputVariables: output } : {}) }
        break
      case 'failServiceTask': {
        const e = (error ?? {}) as { code?: unknown; message?: unknown }
        command = {
          type: 'FailServiceTask',
          tokenId,
          error: {
            code: typeof e.code === 'string' && e.code !== '' ? e.code : 'FORCED_FAILURE',
            message: typeof e.message === 'string' && e.message !== '' ? e.message : why,
          },
        }
        break
      }
      case 'fireTimer':
        command = { type: 'FireTimer', tokenId }
        break
      case 'completeUserTask':
        command = { type: 'CompleteUserTask', tokenId, completedBy: actor, ...(output ? { outputVariables: output } : {}) }
        break
    }

    let result
    try {
      result = execute(definition, command, state)
    } catch (e) {
      if (e instanceof RuntimeError) return c.json({ error: 'RUNTIME_ERROR', message: e.message }, 422)
      throw e
    }

    const onBehalfOf = task?.assignee
    const marker: ExecutionEvent = {
      type: 'StepForced',
      instanceId,
      tokenId,
      elementId: token.elementId,
      action: forced,
      forcedBy: actor,
      reason: why,
      ...(onBehalfOf ? { onBehalfOf } : {}),
    }
    const events = [...result.events, marker]

    const ops = [
      ...computeStoreOps(false, state, result.newState, events),
      ...buildUserTaskCreationOps(result.events, definition, result.newState),
      ...(task ? [{ op: 'updateUserTask' as const, task: { ...task, status: 'completed' as const, completedAt: new Date() } }] : []),
    ]
    await store.executeTransaction(ops)
    await eventBusFor(tenantId).publishMany(events)

    await audit?.record({
      action: 'step.force',
      actor: auditActorOf(principal),
      tenantIds: [tenantId],
      target: instanceId,
      details: { step: forced, elementId: token.elementId, reason: why, ...(onBehalfOf ? { onBehalfOf } : {}) },
    })

    return c.json({ instance: result.newState.instance, events: events.map((e) => e.type) })
  })

  return app
}
