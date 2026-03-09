import { Hono } from 'hono'
import { execute, RuntimeError } from 'nexus-workflow-core'
import type { StateStore } from 'nexus-workflow-core'
import type { EventBus } from 'nexus-workflow-core'
import { loadEngineState, computeStoreOps, buildUserTaskCreationOps } from './engineHelpers.js'

// ─── Router ───────────────────────────────────────────────────────────────────

export function createAdminRouter(store: StateStore, eventBus: EventBus): Hono {
  const app = new Hono()

  // POST /instances/:id/suspend — suspend an active instance
  app.post('/instances/:id/suspend', async (c) => {
    const id = c.req.param('id')

    const state = await loadEngineState(store, id)
    if (!state) return c.json({ error: 'NOT_FOUND', message: `Instance '${id}' not found` }, 404)

    if (state.instance.status !== 'active') {
      return c.json(
        { error: 'INVALID_STATE', message: `Instance is not active (status: ${state.instance.status})` },
        422,
      )
    }

    const definition = await store.getDefinition(state.instance.definitionId, state.instance.definitionVersion)
    if (!definition) return c.json({ error: 'INTERNAL_ERROR', message: 'Definition not found' }, 500)

    let result
    try {
      result = execute(definition, { type: 'SuspendInstance' }, state)
    } catch (e) {
      if (e instanceof RuntimeError) return c.json({ error: 'RUNTIME_ERROR', message: e.message }, 422)
      throw e
    }

    const ops = [
      ...computeStoreOps(false, state, result.newState),
      ...buildUserTaskCreationOps(result.events, definition),
    ]
    await store.executeTransaction(ops)
    await eventBus.publishMany(result.events)

    return c.json({ instance: result.newState.instance })
  })

  // POST /instances/:id/resume — resume a suspended instance
  app.post('/instances/:id/resume', async (c) => {
    const id = c.req.param('id')

    const state = await loadEngineState(store, id)
    if (!state) return c.json({ error: 'NOT_FOUND', message: `Instance '${id}' not found` }, 404)

    if (state.instance.status !== 'suspended') {
      return c.json(
        { error: 'INVALID_STATE', message: `Instance is not suspended (status: ${state.instance.status})` },
        422,
      )
    }

    const definition = await store.getDefinition(state.instance.definitionId, state.instance.definitionVersion)
    if (!definition) return c.json({ error: 'INTERNAL_ERROR', message: 'Definition not found' }, 500)

    let result
    try {
      result = execute(definition, { type: 'ResumeInstance' }, state)
    } catch (e) {
      if (e instanceof RuntimeError) return c.json({ error: 'RUNTIME_ERROR', message: e.message }, 422)
      throw e
    }

    const ops = [
      ...computeStoreOps(false, state, result.newState),
      ...buildUserTaskCreationOps(result.events, definition),
    ]
    await store.executeTransaction(ops)
    await eventBus.publishMany(result.events)

    return c.json({ instance: result.newState.instance })
  })

  // GET /instances/:id/history — execution history for an instance
  app.get('/instances/:id/history', async (c) => {
    const id = c.req.param('id')

    const instance = await store.getInstance(id)
    if (!instance) return c.json({ error: 'NOT_FOUND', message: `Instance '${id}' not found` }, 404)

    const history = await store.getHistory(id)
    return c.json({ history })
  })

  return app
}
