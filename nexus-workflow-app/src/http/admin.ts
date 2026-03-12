import { Hono } from 'hono'
import { execute, RuntimeError, type StateStore, type EventBus } from 'nexus-workflow-core'
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
      ...buildUserTaskCreationOps(result.events, definition, result.newState),
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
      ...buildUserTaskCreationOps(result.events, definition, result.newState),
    ]
    await store.executeTransaction(ops)
    await eventBus.publishMany(result.events)

    return c.json({ instance: result.newState.instance })
  })

  // POST /instances/:id/restart — restart a terminated instance from scratch
  app.post('/instances/:id/restart', async (c) => {
    const id = c.req.param('id')

    const state = await loadEngineState(store, id)
    if (!state) return c.json({ error: 'NOT_FOUND', message: `Instance '${id}' not found` }, 404)

    if (state.instance.status !== 'terminated') {
      return c.json(
        { error: 'INVALID_STATE', message: `Only terminated instances can be restarted (status: ${state.instance.status})` },
        422,
      )
    }

    const definition = await store.getDefinition(state.instance.definitionId, state.instance.definitionVersion)
    if (!definition) return c.json({ error: 'INTERNAL_ERROR', message: 'Definition not found' }, 500)

    const rootScope = await store.getScope(state.instance.rootScopeId)
    const variables = rootScope?.variables ?? {}

    const command = {
      type: 'StartProcess' as const,
      ...(Object.keys(variables).length > 0 ? { variables } : undefined),
      ...(state.instance.correlationKey !== undefined ? { correlationKey: state.instance.correlationKey } : undefined),
      ...(state.instance.businessKey !== undefined ? { businessKey: state.instance.businessKey } : undefined),
    }

    let result
    try {
      result = execute(definition, command, null)
    } catch (e) {
      if (e instanceof RuntimeError) return c.json({ error: 'RUNTIME_ERROR', message: e.message }, 422)
      throw e
    }

    const ops = [
      ...computeStoreOps(true, null, result.newState),
      ...buildUserTaskCreationOps(result.events, definition, result.newState),
    ]
    await store.executeTransaction(ops)
    await eventBus.publishMany(result.events)
    await eventBus.publish({ type: 'ProcessInstanceRestarted', instanceId: result.newState.instance.id, restartedFromId: id })

    return c.json(
      { instance: result.newState.instance, tokens: result.newState.tokens, restartedFromId: id },
      201,
    )
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
