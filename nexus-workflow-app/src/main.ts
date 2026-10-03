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
import { AuditLog } from './db/AuditLog.js'
import { UserAdmin } from './auth/UserAdmin.js'
import { InviteStore } from './db/InviteStore.js'
import { createAuthRouter } from './http/auth.js'
import { createAuditRouter } from './http/audit.js'
import { createUsersRouter } from './http/users.js'
import { mountConsole } from './http/console.js'
import { createTenantsRouter } from './http/tenants.js'
import { createAuthMiddleware, type AppVariables } from './http/middleware/auth.js'
import { createOperatorGuard, createPeopleAdminGuard } from './http/middleware/operator.js'
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
import { SessionStore } from './db/SessionStore.js'
import { UserStore } from './db/UserStore.js'
import { LoginThrottle } from './auth/LoginThrottle.js'
import { PasswordHasher } from './auth/PasswordHasher.js'

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
// The operator console is a static page; it authenticates its own API calls, so it is mounted
// before the auth middleware.
if (mountConsole(app, config.consoleDir)) {
  console.log(`operator console available at http://localhost:${config.port}/console/`)
} else {
  console.log('operator console not built (pnpm --filter nexus-workflow-console build) — /console is not served')
}
// ─── Sign-in for people ───────────────────────────────────────────────────────
// Public routes (they authenticate themselves with a password / the session cookie), so they sit
// before the API-key middleware below. Failed sign-ins are throttled per account from one address
// (so a stranger guessing cannot lock the real owner out), per account overall (guessing spread over
// many addresses) and per address; unknown emails count too.
const MINUTE_MS = 60_000
const userStore = new UserStore(authSql)
const auditLog = new AuditLog(authSql)
const sessionStore = new SessionStore(authSql, {
  hmacSecret: config.apiKeyHmacSecret,
  idleMs: config.sessionIdleMs,
  maxMs: config.sessionMaxMs,
})
const inviteStore = new InviteStore(authSql, { hmacSecret: config.apiKeyHmacSecret, ttlMs: config.inviteTtlMs })
app.route('/auth', createAuthRouter({
  audit: auditLog,
  users: userStore,
  sessions: sessionStore,
  invites: inviteStore,
  hasher: new PasswordHasher(),
  accountIpThrottle: new LoginThrottle({ maxFailures: 5, windowMs: 15 * MINUTE_MS, lockMs: 15 * MINUTE_MS }),
  accountThrottle: new LoginThrottle({ maxFailures: 25, windowMs: 15 * MINUTE_MS, lockMs: 15 * MINUTE_MS }),
  ipThrottle: new LoginThrottle({ maxFailures: 30, windowMs: 15 * MINUTE_MS, lockMs: 15 * MINUTE_MS }),
  sessionMaxAgeSeconds: Math.floor(config.sessionMaxMs / 1000),
  trustedProxies: config.trustedProxies,
  publicOrigin: config.publicOrigin,
}))

// Expired sessions are already refused when used; this just keeps the table small.
const purgeSessions = () =>
  sessionStore.purgeExpired().catch((err) => console.error('[sessions] failed to purge expired sessions:', err))
void purgeSessions()
const sessionPurgeTimer = setInterval(() => void purgeSessions(), 10 * MINUTE_MS)
sessionPurgeTimer.unref()

// People: operators administer everyone, tenant managers only their own tenants' people (UserAdmin
// holds the rules). Same credentials as /tenants, but tenant managers are let in too.
app.route('/users', createUsersRouter({
  admin: new UserAdmin(userStore, inviteStore, auditLog),
  guard: createPeopleAdminGuard({
    adminApiKey: config.adminApiKey,
    sessions: sessionStore,
    users: userStore,
    publicOrigin: config.publicOrigin,
  }),
  publicOrigin: config.publicOrigin,
}))

// The audit log: operators read everything, tenant managers the entries for their own tenants
app.route('/audit', createAuditRouter({
  audit: auditLog,
  guard: createPeopleAdminGuard({
    adminApiKey: config.adminApiKey,
    sessions: sessionStore,
    users: userStore,
    publicOrigin: config.publicOrigin,
  }),
}))

// /tenants is for platform operators: a signed-in operator, or the admin key (break-glass). Tenant
// API keys and tenant managers are refused.
app.route('/tenants', createTenantsRouter(authSql, config.apiKeyHmacSecret, config.adminApiKey, {
  audit: auditLog,
  guard: createOperatorGuard({
    adminApiKey: config.adminApiKey,
    sessions: sessionStore,
    users: userStore,
    publicOrigin: config.publicOrigin,
  }),
  // A suspended or deleted tenant must not keep background workers or connection pools alive
  // (a deleted tenant's schema is dropped right after this returns).
  onTenantDeactivating: async (tenantId) => {
    await tenantWorkers.remove(tenantId)
    await Promise.all([stores.evict(tenantId), eventLogs.evict(tenantId), webhookStores.evict(tenantId)])
  },
}))
// Everything below is a tenant's own data. Programs use a tenant API key (Bearer); a signed-in
// tenant manager can use a session, naming the tenant in the X-Tenant header.
app.use('*', createAuthMiddleware(authSql, config.apiKeyHmacSecret, {
  sessions: sessionStore,
  users: userStore,
  publicOrigin: config.publicOrigin,
}))
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
    clearInterval(sessionPurgeTimer)
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
