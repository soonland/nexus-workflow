import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { timeout } from 'hono/timeout'
import postgres from 'postgres'
import { InMemoryEventBus } from 'nexus-workflow-core'
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
import { createAuthMiddleware } from './http/middleware/auth.js'
import { PostgresWebhookStore } from './webhooks/WebhookStore.js'
import { WebhookDispatcher } from './webhooks/WebhookDispatcher.js'
import { PostgresEventLog } from './db/EventLog.js'
import { TaskWorker } from './worker/TaskWorker.js'
import { HttpCallHandler } from './worker/handlers/HttpCallHandler.js'
import { LogHandler } from './worker/handlers/LogHandler.js'
import { PostgresScheduler } from './scheduler/PostgresScheduler.js'
import { TimerCoordinator } from './scheduler/TimerCoordinator.js'
import { RedisStreamPublisher } from './events/RedisStreamPublisher.js'

assertConfigValid(config)

const authSql = postgres(config.databaseUrl)

// ─── Per-tenant store factory ─────────────────────────────────────────────────
// Each tenant gets a dedicated postgres.js pool scoped to their schema via
// search_path. Pools are cached and bounded to MAX_TENANT_POOLS entries;
// the least-recently-used pool is evicted (and drained) when the limit is hit.
const MAX_TENANT_POOLS = 100
const storesByTenant = new Map<string, PostgresStateStore>()
function storeFactory(tenantId: string): PostgresStateStore {
  const existing = storesByTenant.get(tenantId)
  if (existing) {
    // Refresh insertion order so this tenant stays "recently used"
    storesByTenant.delete(tenantId)
    storesByTenant.set(tenantId, existing)
    return existing
  }
  // Evict the oldest (first) entry if the cache is at capacity
  if (storesByTenant.size >= MAX_TENANT_POOLS) {
    const [oldestId, oldestStore] = storesByTenant.entries().next().value as [string, PostgresStateStore]
    storesByTenant.delete(oldestId)
    void oldestStore.end()
  }
  const store = new PostgresStateStore(config.databaseUrl, tenantId)
  storesByTenant.set(tenantId, store)
  return store
}

// Background workers (TaskWorker, TimerCoordinator) use the default tenant.
// Multi-tenant worker support (routing tasks to the correct tenant store) is
// a known limitation — deferred to a later phase.
const defaultStore = storeFactory('default')

const eventBus = new InMemoryEventBus()
const eventLog = new PostgresEventLog(config.databaseUrl)
eventBus.subscribe(event => { void eventLog.append(event) })

await runMigrations(config.databaseUrl)

let redisPublisher: RedisStreamPublisher | null = null
if (config.redisUrl) {
  redisPublisher = new RedisStreamPublisher(config.redisUrl)
  await redisPublisher.connect()
  redisPublisher.attach(eventBus)
}

const webhookStore = new PostgresWebhookStore(config.databaseUrl)
const webhookDispatcher = new WebhookDispatcher(webhookStore, eventBus)
webhookDispatcher.start()

const worker = new TaskWorker(defaultStore, eventBus)
worker.register(new HttpCallHandler())
worker.register(new LogHandler())
worker.start()

const scheduler = new PostgresScheduler(defaultStore, { pollIntervalMs: 5_000 })
const timerCoordinator = new TimerCoordinator(defaultStore, eventBus, scheduler)
timerCoordinator.start()
await scheduler.start()

const app = new Hono()
app.use(timeout(config.requestTimeoutMs))
app.use('*', createAuthMiddleware(authSql, config.apiKeyHmacSecret))
app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/definitions', createDefinitionsRouter(storeFactory))
app.route('/', createInstancesRouter(storeFactory, eventBus))
app.route('/', createTasksRouter(storeFactory, eventBus))
app.route('/', createAdminRouter(storeFactory, eventBus))
app.route('/', createEventsRouter(storeFactory, eventBus))
app.route('/', createObservabilityRouter(storeFactory, eventLog))
app.route('/', createWebhooksRouter(webhookStore))

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
    worker.stop()
    timerCoordinator.stop()
    await scheduler.stop()

    // 3. Disconnect Redis
    if (redisPublisher) await redisPublisher.disconnect()

    // 4. Close DB pools — postgres.js waits for active queries before closing
    await authSql.end()
    await webhookStore.end()
    for (const tenantStore of storesByTenant.values()) {
      await tenantStore.end()
    }

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
