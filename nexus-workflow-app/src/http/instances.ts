import { Hono } from 'hono'
import { execute, RuntimeError, DefinitionError, type StateStore, type EngineCommand, type InstanceQuery, type InstanceStatus, type VariableValue, type EventBus } from 'nexus-workflow-core'
import { loadEngineState, computeStoreOps, buildUserTaskCreationOps, normalizeVariables, unwrapVariables } from './engineHelpers.js'
import { validationError, startInstanceBodySchema, listInstancesQuerySchema, instanceStatusSchema, commandBodySchema } from './validation.js'

// ─── Router ───────────────────────────────────────────────────────────────────

export function createInstancesRouter(store: StateStore, eventBus: EventBus): Hono {
  const app = new Hono()

  // POST /definitions/:definitionId/instances — start a new instance
  app.post('/definitions/:definitionId/instances', async (c) => {
    const definitionId = c.req.param('definitionId')

    const definition = await store.getDefinition(definitionId)
    if (!definition) {
      return c.json({ error: 'NOT_FOUND', message: `Definition '${definitionId}' not found` }, 404)
    }
    if (!definition.isDeployable) {
      return c.json({ error: 'NOT_DEPLOYABLE', message: `Definition '${definitionId}' is not deployable` }, 422)
    }

    let variables: Record<string, VariableValue> | undefined
    let correlationKey: string | undefined
    let businessKey: string | undefined

    const contentType = c.req.header('content-type') ?? ''
    if (contentType.includes('application/json')) {
      let rawBody: unknown
      try {
        rawBody = await c.req.json()
      } catch {
        return c.json({ error: 'VALIDATION_ERROR', issues: { formErrors: ['Request body is not valid JSON'], fieldErrors: {} } }, 400)
      }
      const parsed = startInstanceBodySchema.safeParse(rawBody)
      if (!parsed.success) return c.json(validationError(parsed.error), 400)
      const b = parsed.data
      if (b.variables !== undefined) variables = normalizeVariables(b.variables)
      if (b.correlationKey !== undefined) correlationKey = b.correlationKey
      if (b.businessKey !== undefined) businessKey = b.businessKey
    }

    const command: EngineCommand = {
      type: 'StartProcess',
      ...(variables !== undefined ? { variables } : undefined),
      ...(correlationKey !== undefined ? { correlationKey } : undefined),
      ...(businessKey !== undefined ? { businessKey } : undefined),
    }

    let result
    try {
      result = execute(definition, command, null)
    } catch (e) {
      if (e instanceof RuntimeError) return c.json({ error: 'RUNTIME_ERROR', message: e.message }, 422)
      if (e instanceof DefinitionError) return c.json({ error: 'DEFINITION_ERROR', message: e.message }, 500)
      throw e
    }

    const ops = [
      ...computeStoreOps(true, null, result.newState),
      ...buildUserTaskCreationOps(result.events, definition, result.newState),
    ]
    await store.executeTransaction(ops)
    await eventBus.publishMany(result.events)

    return c.json({ instance: result.newState.instance, tokens: result.newState.tokens }, 201)
  })

  // GET /instances — list instances with optional filters
  app.get('/instances', async (c) => {
    const parsed = listInstancesQuerySchema.safeParse(c.req.query())
    if (!parsed.success) return c.json(validationError(parsed.error), 400)
    const q = parsed.data

    const query: InstanceQuery = { page: q.page, pageSize: q.pageSize }
    if (q.definitionId) query.definitionId = q.definitionId
    if (q.correlationKey) query.correlationKey = q.correlationKey
    if (q.businessKey) query.businessKey = q.businessKey
    if (q.status) {
      const statuses = q.status.split(',').map(x => x.trim())
      for (const s of statuses) {
        const statusParsed = instanceStatusSchema.safeParse(s)
        if (!statusParsed.success) {
          return c.json({ error: 'VALIDATION_ERROR', issues: { formErrors: [`Invalid status value: '${s}'`], fieldErrors: {} } }, 400)
        }
      }
      const validStatuses = statuses as InstanceStatus[]
      const firstStatus = validStatuses[0]
      query.status = validStatuses.length === 1 && firstStatus !== undefined ? firstStatus : validStatuses
    }
    if (q.startedAfter) query.startedAfter = new Date(q.startedAfter)
    if (q.startedBefore) query.startedBefore = new Date(q.startedBefore)

    const result = await store.findInstances(query)
    return c.json(result)
  })

  // GET /instances/:id — get instance details
  app.get('/instances/:id', async (c) => {
    const id = c.req.param('id')

    const instance = await store.getInstance(id)
    if (!instance) return c.json({ error: 'NOT_FOUND', message: `Instance '${id}' not found` }, 404)

    const tokens = await store.getActiveTokens(id)
    const rootScope = await store.getScope(instance.rootScopeId)

    return c.json({ instance, tokens, variables: unwrapVariables(rootScope?.variables ?? {}) })
  })

  // POST /instances/:id/commands — send a command to an instance
  app.post('/instances/:id/commands', async (c) => {
    const id = c.req.param('id')

    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      return c.json({ error: 'VALIDATION_ERROR', issues: { formErrors: ['Request body is not valid JSON'], fieldErrors: {} } }, 400)
    }

    const parsed = commandBodySchema.safeParse(rawBody)
    if (!parsed.success) return c.json(validationError(parsed.error), 400)

    const command = parsed.data as EngineCommand

    const state = await loadEngineState(store, id)
    if (!state) return c.json({ error: 'NOT_FOUND', message: `Instance '${id}' not found` }, 404)

    const definition = await store.getDefinition(state.instance.definitionId, state.instance.definitionVersion)
    if (!definition) return c.json({ error: 'INTERNAL_ERROR', message: 'Definition not found' }, 500)

    let result
    try {
      result = execute(definition, command, state)
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

  // DELETE /instances/:id — cancel an instance
  app.delete('/instances/:id', async (c) => {
    const id = c.req.param('id')

    const state = await loadEngineState(store, id)
    if (!state) return c.json({ error: 'NOT_FOUND', message: `Instance '${id}' not found` }, 404)

    if (state.instance.status === 'terminated' || state.instance.status === 'completed') {
      // Re-emit the terminal event so downstream consumers (e.g. Redis stream) can reconcile
      // stale records in case they missed the original event.
      await eventBus.publish({ type: 'ProcessInstanceTerminated', instanceId: id, reason: 'already terminated' })
      return c.json({ instance: state.instance })
    }

    const definition = await store.getDefinition(state.instance.definitionId, state.instance.definitionVersion)
    if (!definition) return c.json({ error: 'INTERNAL_ERROR', message: 'Definition not found' }, 500)

    let result
    try {
      result = execute(definition, { type: 'CancelInstance' }, state)
    } catch (e) {
      if (e instanceof RuntimeError) return c.json({ error: 'RUNTIME_ERROR', message: e.message }, 422)
      throw e
    }

    // Cancel any open user tasks that belong to this instance
    const openTasks = await store.queryUserTasks({ instanceId: id, status: 'open', page: 0, pageSize: 1000 })
    const cancelOps = openTasks.items.map((task) => ({
      op: 'updateUserTask' as const,
      task: { ...task, status: 'cancelled' as const, completedAt: new Date() },
    }))

    const ops = [
      ...computeStoreOps(false, state, result.newState),
      ...buildUserTaskCreationOps(result.events, definition, result.newState),
      ...cancelOps,
    ]
    await store.executeTransaction(ops)
    await eventBus.publishMany(result.events)

    return c.json({ instance: result.newState.instance })
  })

  return app
}
