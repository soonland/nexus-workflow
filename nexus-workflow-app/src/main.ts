import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { timeout } from 'hono/timeout'
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

const store = new PostgresStateStore(config.databaseUrl)
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

const worker = new TaskWorker(store, eventBus)
worker.register(new HttpCallHandler())
worker.register(new LogHandler())
worker.start()

const scheduler = new PostgresScheduler(store, { pollIntervalMs: 5_000 })
const timerCoordinator = new TimerCoordinator(store, eventBus, scheduler)
timerCoordinator.start()
await scheduler.start()

const app = new Hono()
app.use(timeout(config.requestTimeoutMs))
app.use('*', createAuthMiddleware(config.apiKeys))
app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/definitions', createDefinitionsRouter(store, store))
app.route('/', createInstancesRouter(store, eventBus))
app.route('/', createTasksRouter(store, eventBus))
app.route('/', createAdminRouter(store, eventBus))
app.route('/', createEventsRouter(store, eventBus))
app.route('/', createObservabilityRouter(store, eventLog))
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
    await webhookStore.end()
    await store.end()

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
