import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { InMemoryEventBus } from 'nexus-workflow-core'
import { config } from './config.js'
import { PostgresStateStore } from './db/PostgresStateStore.js'
import { runMigrations, resetDatabase } from './db/migrate.js'
import { createDefinitionsRouter } from './http/definitions.js'
import { createInstancesRouter } from './http/instances.js'
import { createTasksRouter } from './http/tasks.js'
import { createAdminRouter } from './http/admin.js'
import { createEventsRouter } from './http/events.js'
import { createObservabilityRouter } from './http/observability.js'
import { PostgresEventLog } from './db/EventLog.js'
import { TaskWorker } from './worker/TaskWorker.js'
import { HttpCallHandler } from './worker/handlers/HttpCallHandler.js'
import { LogHandler } from './worker/handlers/LogHandler.js'
import { PostgresScheduler } from './scheduler/PostgresScheduler.js'
import { TimerCoordinator } from './scheduler/TimerCoordinator.js'
import { RedisStreamPublisher } from './events/RedisStreamPublisher.js'

const store = new PostgresStateStore(config.databaseUrl)
const eventBus = new InMemoryEventBus()
const eventLog = new PostgresEventLog(config.databaseUrl)
eventBus.subscribe(event => { void eventLog.append(event) })

if (config.redisUrl) {
  const redisPublisher = new RedisStreamPublisher(config.redisUrl)
  await redisPublisher.connect()
  redisPublisher.attach(eventBus)
}

const worker = new TaskWorker(store, eventBus)
worker.register(new HttpCallHandler())
worker.register(new LogHandler())
worker.start()

const scheduler = new PostgresScheduler(store, { pollIntervalMs: 5_000 })
const timerCoordinator = new TimerCoordinator(store, eventBus, scheduler)
timerCoordinator.start()
await scheduler.start()

const app = new Hono()
app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/definitions', createDefinitionsRouter(store, store))
app.route('/', createInstancesRouter(store, eventBus))
app.route('/', createTasksRouter(store, eventBus))
app.route('/', createAdminRouter(store, eventBus))
app.route('/', createEventsRouter(store, eventBus))
app.route('/', createObservabilityRouter(store, eventLog))

if (config.resetDb) {
  await resetDatabase(config.databaseUrl)
} else {
  await runMigrations(config.databaseUrl)
}
serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`nexus-workflow-app listening on port ${config.port}`)
})
