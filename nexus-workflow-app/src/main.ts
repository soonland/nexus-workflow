import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { timeout } from 'hono/timeout'
import postgres from 'postgres'
import { config, assertConfigValid } from './config.js'
import { PostgresStateStore } from './db/PostgresStateStore.js'
import { runMigrations } from './db/migrate.js'
import { createDefinitionsRouter } from './http/definitions.js'
import { createInstancesRouter } from './http/instances.js'
import { createTasksRouter } from './http/tasks.js'
import { createAdminRouter } from './http/admin.js'
import { createEventsRouter } from './http/events.js'
import { createObservabilityRouter } from './http/observability.js'
import { createWebhooksRouter } from './http/webhooks.js'
import { createTenantsRouter } from './http/tenants.js'
import { createAuthMiddleware, type AppVariables } from './http/middleware/auth.js'
import { PostgresWebhookStore } from './webhooks/WebhookStore.js'
import { WebhookDispatcher } from './webhooks/WebhookDispatcher.js'
import { PostgresEventLog } from './db/EventLog.js'
import { HttpCallHandler } from './worker/handlers/HttpCallHandler.js'
import { LogHandler } from './worker/handlers/LogHandler.js'
import { TenantWorkerManager } from './worker/TenantWorkerManager.js'
import { createTenantWorkers } from './worker/createTenantWorkers.js'
import { RedisStreamPublisher } from './events/RedisStreamPublisher.js'
import { TenantEventHub } from './events/TenantEventHub.js'
import { TenantResourceCache } from './db/TenantResourceCache.js'

assertConfigValid(config)

const authSql = postgres(config.databaseUrl)

// ─── Per-tenant resources ─────────────────────────────────────────────────────
// Each tenant gets dedicated postgres.js pools scoped to their schema via
// search_path. Pools are cached and bounded to MAX_TENANT_POOLS entries per kind;
// the least-recently-used pool is evicted (and drained) when the limit is hit.
const MAX_TENANT_POOLS = 100
const stores = new TenantResourceCache((tenantId) => new PostgresStateStore(config.databaseUrl, tenantId), MAX_TENANT_POOLS)
const eventLogs = new TenantResourceCache((tenantId) => new PostgresEventLog(config.databaseUrl, tenantId), MAX_TENANT_POOLS)
const webhookStores = new TenantResourceCache((tenantId) => new PostgresWebhookStore(config.databaseUrl, tenantId), MAX_TENANT_POOLS)
const storeFactory = (tenantId: string) => stores.get(tenantId)
const eventLogFor = (tenantId: string) => eventLogs.get(tenantId)
const webhookStoreFor = (tenantId: string) => webhookStores.get(tenantId)

// Every event is tagged with the tenant that produced it, so the audit log, webhooks and
// Redis stream can route it to the right place. Routers get a per-tenant bus.
const eventHub = new TenantEventHub()
const eventBusFor = (tenantId: string) => eventHub.busFor(tenantId)
eventHub.subscribeAll((tenantId, event) => {
  eventLogFor(tenantId).append(event).catch(err => {
    console.error(`[eventLog] failed to append event for tenant '${tenantId}':`, err)
  })
})

await runMigrations(config.databaseUrl)

let redisPublisher: RedisStreamPublisher | null = null
if (config.redisUrl) {
  redisPublisher = new RedisStreamPublisher(config.redisUrl)
  await redisPublisher.connect()
  redisPublisher.attach(eventHub)
}

const webhookDispatcher = new WebhookDispatcher(webhookStoreFor, eventHub)
webhookDispatcher.start()

// ─── Per-tenant background workers ────────────────────────────────────────────
// Each active tenant gets its own service-task worker and timer scheduler, bound to that
// tenant's schema and events. Workers for tenants that already have persisted work start
// here; every authenticated request also calls ensure() (see below) so a brand-new tenant
// has workers running before its first event is published.
const tenantWorkers = new TenantWorkerManager({
  listActiveTenantIds: async () => {
    const rows = await authSql<{ id: string }[]>`
      SELECT t.id FROM public.tenants t
      WHERE t.status = 'active'
        AND EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'tenant_' || t.id)
    `
    return rows.map(r => r.id)
  },
  createWorkers: (tenantId) => createTenantWorkers(tenantId, {
    databaseUrl: config.databaseUrl,
    eventBusFor,
    handlers: [new HttpCallHandler(), new LogHandler()],
  }),
})
await tenantWorkers.start()

const app = new Hono<{ Variables: AppVariables }>()
app.use(timeout(config.requestTimeoutMs))
// /tenants is protected by the admin API key, not the DB-backed tenant key
app.route('/tenants', createTenantsRouter(authSql, config.apiKeyHmacSecret, config.adminApiKey, {
  // A suspended or deleted tenant must not keep background workers or connection pools alive
  // (a deleted tenant's schema is dropped right after this returns).
  onTenantDeactivating: async (tenantId) => {
    await tenantWorkers.remove(tenantId)
    await Promise.all([stores.evict(tenantId), eventLogs.evict(tenantId), webhookStores.evict(tenantId)])
  },
}))
app.use('*', createAuthMiddleware(authSql, config.apiKeyHmacSecret))
// Workers must be running before the tenant's first event is published (they subscribe to
// in-process events), so start them here rather than waiting for the next registry sync.
app.use('*', async (c, next) => {
  const tenantId = c.get('tenantId')
  if (tenantId) await tenantWorkers.ensure(tenantId)
  return next()
})
app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/definitions', createDefinitionsRouter(storeFactory))
app.route('/', createInstancesRouter(storeFactory, eventBusFor))
app.route('/', createTasksRouter(storeFactory, eventBusFor))
app.route('/', createAdminRouter(storeFactory, eventBusFor))
app.route('/', createEventsRouter(storeFactory, eventBusFor))
app.route('/', createObservabilityRouter(storeFactory, eventLogFor))
app.route('/', createWebhooksRouter(webhookStoreFor))

const server = serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`nexus-workflow-app listening on port ${config.port}`)
})

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`[shutdown] received ${signal}, draining (timeout: ${config.shutdownTimeoutMs} ms)`)

  const forceExit = setTimeout(() => {
    console.error('[shutdown] drain timeout exceeded, forcing exit')
    process.exit(1)
  }, config.shutdownTimeoutMs)
  // Don't let this timer prevent the process from exiting on its own
  forceExit.unref()

  try {
    // 1. Stop accepting new connections; wait for in-flight HTTP requests to finish
    // closeIdleConnections() drains idle keep-alive sockets (Node ≥ 18.2) so that
    // server.close() resolves without waiting for them to time out naturally.
    ;(server as unknown as import('node:http').Server).closeIdleConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))

    // 2. Stop background workers — unsubscribes from events; in-flight tasks settle independently
    webhookDispatcher.stop()
    await tenantWorkers.stop()

    // 3. Disconnect Redis
    if (redisPublisher) await redisPublisher.disconnect()

    // 4. Close DB pools — postgres.js waits for active queries before closing
    await authSql.end()
    await webhookStores.endAll()
    await eventLogs.endAll()
    await stores.endAll()

    clearTimeout(forceExit)
    console.log('[shutdown] clean exit')
    process.exit(0)
  } catch (err) {
    console.error('[shutdown] error during shutdown:', err)
    process.exit(1)
  }
}

process.once('SIGTERM', () => { void shutdown('SIGTERM') })
process.once('SIGINT', () => { void shutdown('SIGINT') })
