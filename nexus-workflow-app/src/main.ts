import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { InMemoryEventBus } from 'nexus-workflow-core'
import { config } from './config.js'
import { PostgresStateStore } from './db/PostgresStateStore.js'
import { runMigrations } from './db/migrate.js'
import { createDefinitionsRouter } from './http/definitions.js'
import { createInstancesRouter } from './http/instances.js'
import { TaskWorker } from './worker/TaskWorker.js'
import { HttpCallHandler } from './worker/handlers/HttpCallHandler.js'
import { LogHandler } from './worker/handlers/LogHandler.js'
import { PostgresScheduler } from './scheduler/PostgresScheduler.js'
import { TimerCoordinator } from './scheduler/TimerCoordinator.js'

const store = new PostgresStateStore(config.databaseUrl)
const eventBus = new InMemoryEventBus()

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
app.route('/definitions', createDefinitionsRouter(store))
app.route('/', createInstancesRouter(store, eventBus))

await runMigrations(config.databaseUrl)
serve({ fetch: app.fetch, port: config.port }, () => {
  console.log(`nexus-workflow-app listening on port ${config.port}`)
})
