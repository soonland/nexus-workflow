import { Hono } from 'hono'
import { execute, RuntimeError, type StateStore, type VariableValue, type EventBus } from 'nexus-workflow-core'
import { loadEngineState, computeStoreOps, buildUserTaskCreationOps } from './engineHelpers.js'

// ─── Router ───────────────────────────────────────────────────────────────────

export function createEventsRouter(store: StateStore, eventBus: EventBus): Hono {
  const app = new Hono()

  // POST /messages — deliver a message to the subscribed instance
  app.post('/messages', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_BODY', message: 'Request body is not valid JSON' }, 400)
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'INVALID_BODY', message: 'Request body must be an object' }, 400)
    }

    const b = body as Record<string, unknown>
    const { messageName, correlationValue, variables } = b

    if (!messageName || typeof messageName !== 'string') {
      return c.json({ error: 'INVALID_BODY', message: "'messageName' is required" }, 400)
    }
    if (correlationValue !== undefined && typeof correlationValue !== 'string') {
      return c.json({ error: 'INVALID_BODY', message: "'correlationValue' must be a string" }, 400)
    }

    const subscriptions = await store.findSubscriptions({
      type: 'message',
      messageName,
      ...(correlationValue !== undefined ? { correlationValue } : {}),
    })

    if (subscriptions.length === 0) {
      return c.json({ error: 'NOT_FOUND', message: `No active subscription for message '${messageName}'` }, 404)
    }

    // Messages are 1-to-1: deliver to the first matching subscription
    const sub = subscriptions[0]
    if (!sub) return c.json({ error: 'INTERNAL_ERROR', message: 'No matching subscription found' }, 500)
    const state = await loadEngineState(store, sub.instanceId)
    if (!state) return c.json({ error: 'INTERNAL_ERROR', message: 'Instance state not found' }, 500)

    const definition = await store.getDefinition(state.instance.definitionId, state.instance.definitionVersion)
    if (!definition) return c.json({ error: 'INTERNAL_ERROR', message: 'Definition not found' }, 500)

    let result
    try {
      result = execute(
        definition,
        {
          type: 'DeliverMessage',
          messageName,
          ...(variables !== undefined ? { variables: variables as Record<string, VariableValue> } : {}),
        },
        state,
      )
    } catch (e) {
      if (e instanceof RuntimeError) return c.json({ error: 'RUNTIME_ERROR', message: e.message }, 422)
      throw e
    }

    const ops = [
      ...computeStoreOps(false, state, result.newState),
      ...buildUserTaskCreationOps(result.events, definition, result.newState),
    ]
    await store.executeTransaction(ops)
    await eventBus.publishMany(result.events)

    return c.json({ instance: result.newState.instance, events: result.events.map(ev => ev.type) })
  })

  // POST /signals — broadcast a signal to all subscribed instances
  app.post('/signals', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_BODY', message: 'Request body is not valid JSON' }, 400)
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'INVALID_BODY', message: 'Request body must be an object' }, 400)
    }

    const b = body as Record<string, unknown>
    const { signalName, variables } = b

    if (!signalName || typeof signalName !== 'string') {
      return c.json({ error: 'INVALID_BODY', message: "'signalName' is required" }, 400)
    }

    const subscriptions = await store.findSubscriptions({ type: 'signal', signalName })

    const results: Array<{ instanceId: string; events: string[] }> = []

    for (const sub of subscriptions) {
      const state = await loadEngineState(store, sub.instanceId)
      if (!state) continue

      const definition = await store.getDefinition(state.instance.definitionId, state.instance.definitionVersion)
      if (!definition) continue

      let result
      try {
        result = execute(
          definition,
          {
            type: 'BroadcastSignal',
            signalName,
            ...(variables !== undefined ? { variables: variables as Record<string, VariableValue> } : {}),
          },
          state,
        )
      } catch {
        continue
      }

      const ops = [
        ...computeStoreOps(false, state, result.newState),
        ...buildUserTaskCreationOps(result.events, definition, result.newState),
      ]
      await store.executeTransaction(ops)
      await eventBus.publishMany(result.events)

      results.push({ instanceId: sub.instanceId, events: result.events.map(ev => ev.type) })
    }

    return c.json({ delivered: results.length, results })
  })

  return app
}
