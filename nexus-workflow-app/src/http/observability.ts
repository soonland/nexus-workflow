import { Hono } from 'hono'
import type { StateStore } from 'nexus-workflow-core'
import type { EventLog } from '../db/EventLog.js'
import type { AppVariables } from './middleware/auth.js'

// ─── Router ───────────────────────────────────────────────────────────────────

export function createObservabilityRouter(storeFactory: (tenantId: string) => StateStore, eventLog: EventLog): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>()

  // GET /instances/:id/events — full audit trail for an instance
  app.get('/instances/:id/events', async (c) => {
    const store = storeFactory(c.get('tenantId'))
    const id = c.req.param('id')

    const instance = await store.getInstance(id)
    if (!instance) return c.json({ error: 'NOT_FOUND', message: `Instance '${id}' not found` }, 404)

    const events = await eventLog.getForInstance(id)
    return c.json({ events })
  })

  // GET /metrics — active instances, suspended instances, task queue depth
  app.get('/metrics', async (c) => {
    const store = storeFactory(c.get('tenantId'))
    const [activeResult, suspendedResult, openResult, claimedResult] = await Promise.all([
      store.findInstances({ status: 'active', page: 0, pageSize: 1 }),
      store.findInstances({ status: 'suspended', page: 0, pageSize: 1 }),
      store.queryUserTasks({ status: 'open', page: 0, pageSize: 1 }),
      store.queryUserTasks({ status: 'claimed', page: 0, pageSize: 1 }),
    ])

    return c.json({
      instances: {
        active: activeResult.total,
        suspended: suspendedResult.total,
      },
      tasks: {
        pending: openResult.total + claimedResult.total,
      },
    })
  })

  return app
}
