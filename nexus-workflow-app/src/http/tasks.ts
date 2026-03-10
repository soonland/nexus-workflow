import { Hono } from 'hono'
import { execute, RuntimeError } from 'nexus-workflow-core'
import type { StateStore, UserTaskQuery, UserTaskStatus, VariableValue } from 'nexus-workflow-core'
import type { EventBus } from 'nexus-workflow-core'
import { loadEngineState, computeStoreOps, buildUserTaskCreationOps, normalizeVariables, unwrapVariables } from './engineHelpers.js'

// ─── Router ───────────────────────────────────────────────────────────────────

export function createTasksRouter(store: StateStore, eventBus: EventBus): Hono {
  const app = new Hono()

  // GET /tasks — list user tasks
  app.get('/tasks', async (c) => {
    const query: UserTaskQuery = {
      page: Number(c.req.query('page') ?? 0),
      pageSize: Number(c.req.query('pageSize') ?? 20),
    }

    const qInstanceId = c.req.query('instanceId')
    if (qInstanceId) query.instanceId = qInstanceId
    const qAssignee = c.req.query('assignee')
    if (qAssignee) query.assignee = qAssignee
    const qCandidateGroup = c.req.query('candidateGroup')
    if (qCandidateGroup) query.candidateGroup = qCandidateGroup
    const qStatus = c.req.query('status')
    if (qStatus) query.status = qStatus as UserTaskStatus

    const result = await store.queryUserTasks(query)
    return c.json(result)
  })

  // GET /tasks/:id — get task details + variables in scope
  app.get('/tasks/:id', async (c) => {
    const id = c.req.param('id')

    const task = await store.getUserTask(id)
    if (!task) return c.json({ error: 'NOT_FOUND', message: `Task '${id}' not found` }, 404)

    // Load variables from the token's scope chain
    const tokens = await store.getAllTokens(task.instanceId)
    const token = tokens.find(t => t.id === task.tokenId)
    let variables: Record<string, VariableValue> = {}
    if (token) {
      const scopeChain = await store.getScopeChain(token.scopeId)
      // scopeChain is leaf-to-root; merge root first so child scopes win
      for (const scope of [...scopeChain].reverse()) {
        variables = { ...variables, ...scope.variables }
      }
    }

    return c.json({ task, variables: unwrapVariables(variables) })
  })

  // POST /tasks/:id/complete — submit task completion with optional output variables
  app.post('/tasks/:id/complete', async (c) => {
    const id = c.req.param('id')

    const task = await store.getUserTask(id)
    if (!task) return c.json({ error: 'NOT_FOUND', message: `Task '${id}' not found` }, 404)

    if (task.status === 'completed' || task.status === 'cancelled') {
      return c.json(
        { error: 'INVALID_STATE', message: `Task '${id}' is already ${task.status}` },
        422,
      )
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_BODY', message: 'Request body is not valid JSON' }, 400)
    }

    const b = body as Record<string, unknown>
    const completedBy = b['completedBy']
    if (!completedBy || typeof completedBy !== 'string') {
      return c.json({ error: 'INVALID_BODY', message: "'completedBy' is required" }, 400)
    }

    const outputVariables = b['outputVariables'] !== undefined
      ? normalizeVariables(b['outputVariables'] as Record<string, unknown>)
      : undefined

    const state = await loadEngineState(store, task.instanceId)
    if (!state) return c.json({ error: 'INTERNAL_ERROR', message: 'Instance state not found' }, 500)

    const definition = await store.getDefinition(
      state.instance.definitionId,
      state.instance.definitionVersion,
    )
    if (!definition) return c.json({ error: 'INTERNAL_ERROR', message: 'Definition not found' }, 500)

    let result
    try {
      result = execute(definition, {
        type: 'CompleteUserTask',
        tokenId: task.tokenId,
        completedBy,
        ...(outputVariables !== undefined ? { outputVariables } : {}),
      }, state)
    } catch (e) {
      if (e instanceof RuntimeError) return c.json({ error: 'RUNTIME_ERROR', message: e.message }, 422)
      throw e
    }

    const completedTask = { ...task, status: 'completed' as const, completedAt: new Date() }
    const ops = [
      ...computeStoreOps(false, state, result.newState),
      ...buildUserTaskCreationOps(result.events, definition, result.newState),
      { op: 'updateUserTask' as const, task: completedTask },
    ]
    await store.executeTransaction(ops)
    await eventBus.publishMany(result.events)

    return c.json({ task: completedTask, instance: result.newState.instance })
  })

  // POST /tasks/:id/claim — assign a task to a user
  app.post('/tasks/:id/claim', async (c) => {
    const id = c.req.param('id')

    const task = await store.getUserTask(id)
    if (!task) return c.json({ error: 'NOT_FOUND', message: `Task '${id}' not found` }, 404)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_BODY', message: 'Request body is not valid JSON' }, 400)
    }

    const claimedBy = (body as Record<string, unknown>)['claimedBy']
    if (!claimedBy || typeof claimedBy !== 'string') {
      return c.json({ error: 'INVALID_BODY', message: "'claimedBy' is required" }, 400)
    }

    const updatedTask = { ...task, status: 'claimed' as const, assignee: claimedBy, claimedAt: new Date() }
    await store.executeTransaction([{ op: 'updateUserTask', task: updatedTask }])
    await eventBus.publish({ type: 'UserTaskClaimed', taskId: id, claimedBy })

    return c.json({ task: updatedTask })
  })

  // POST /tasks/:id/release — unassign a task
  app.post('/tasks/:id/release', async (c) => {
    const id = c.req.param('id')

    const task = await store.getUserTask(id)
    if (!task) return c.json({ error: 'NOT_FOUND', message: `Task '${id}' not found` }, 404)

    const { assignee: _a, claimedAt: _c, ...taskBase } = task
    const updatedTask = { ...taskBase, status: 'open' as const }
    await store.executeTransaction([{ op: 'updateUserTask', task: updatedTask }])
    await eventBus.publish({ type: 'UserTaskReleased', taskId: id })

    return c.json({ task: updatedTask })
  })

  return app
}
