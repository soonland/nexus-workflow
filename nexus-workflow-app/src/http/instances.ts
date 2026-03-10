import { Hono } from 'hono'
import { execute, RuntimeError, DefinitionError } from 'nexus-workflow-core'
import type {
  StateStore,
  EngineCommand,
  InstanceQuery,
  InstanceStatus,
  VariableValue,
} from 'nexus-workflow-core'
import type { EventBus } from 'nexus-workflow-core'
import { loadEngineState, computeStoreOps, buildUserTaskCreationOps } from './engineHelpers.js'

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
      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: 'INVALID_BODY', message: 'Request body is not valid JSON' }, 400)
      }
      if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
        const b = body as Record<string, unknown>
        if (b['variables'] !== undefined) {
          if (typeof b['variables'] !== 'object' || Array.isArray(b['variables']) || b['variables'] === null) {
            return c.json({ error: 'INVALID_BODY', message: "'variables' must be an object" }, 400)
          }
          variables = b['variables'] as Record<string, VariableValue>
        }
        if (b['correlationKey'] !== undefined) {
          if (typeof b['correlationKey'] !== 'string') {
            return c.json({ error: 'INVALID_BODY', message: "'correlationKey' must be a string" }, 400)
          }
          correlationKey = b['correlationKey']
        }
        if (b['businessKey'] !== undefined) {
          if (typeof b['businessKey'] !== 'string') {
            return c.json({ error: 'INVALID_BODY', message: "'businessKey' must be a string" }, 400)
          }
          businessKey = b['businessKey']
        }
      }
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
    const query: InstanceQuery = {
      page: Number(c.req.query('page') ?? 0),
      pageSize: Number(c.req.query('pageSize') ?? 20),
    }

    const qDefinitionId = c.req.query('definitionId')
    if (qDefinitionId) query.definitionId = qDefinitionId
    const qCorrelationKey = c.req.query('correlationKey')
    if (qCorrelationKey) query.correlationKey = qCorrelationKey
    const qBusinessKey = c.req.query('businessKey')
    if (qBusinessKey) query.businessKey = qBusinessKey
    if (c.req.query('status')) {
      const s = c.req.query('status')!
      const statuses = s.split(',').map(x => x.trim()) as InstanceStatus[]
      query.status = statuses.length === 1 ? statuses[0]! : statuses
    }
    if (c.req.query('startedAfter')) {
      query.startedAfter = new Date(c.req.query('startedAfter')!)
    }
    if (c.req.query('startedBefore')) {
      query.startedBefore = new Date(c.req.query('startedBefore')!)
    }

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

    return c.json({ instance, tokens, variables: rootScope?.variables ?? {} })
  })

  // POST /instances/:id/commands — send a command to an instance
  app.post('/instances/:id/commands', async (c) => {
    const id = c.req.param('id')

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_BODY', message: 'Request body is not valid JSON' }, 400)
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'INVALID_BODY', message: 'Request body must be an object' }, 400)
    }

    const { type } = body as Record<string, unknown>

    const VALID_COMMAND_TYPES = [
      'CompleteServiceTask', 'FailServiceTask', 'CompleteUserTask',
      'FireTimer', 'DeliverMessage', 'BroadcastSignal',
      'SuspendInstance', 'ResumeInstance', 'CancelInstance',
    ]

    if (!type || typeof type !== 'string' || !VALID_COMMAND_TYPES.includes(type)) {
      return c.json({ error: 'INVALID_COMMAND', message: `Unknown command type: '${String(type)}'` }, 400)
    }

    const command = body as EngineCommand

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

    const ops = [
      ...computeStoreOps(false, state, result.newState),
      ...buildUserTaskCreationOps(result.events, definition, result.newState),
    ]
    await store.executeTransaction(ops)
    await eventBus.publishMany(result.events)

    return c.json({ instance: result.newState.instance })
  })

  return app
}
