import type { EventBus, ServiceTaskHandler } from 'nexus-workflow-core'
import { PostgresStateStore } from '../db/PostgresStateStore.js'
import { PostgresScheduler } from '../scheduler/PostgresScheduler.js'
import { TimerCoordinator } from '../scheduler/TimerCoordinator.js'
import { TaskWorker } from './TaskWorker.js'
import type { TenantWorkerSet } from './TenantWorkerManager.js'

export interface TenantWorkerDeps {
  databaseUrl: string
  /** Tenant-scoped event bus: the workers only see their own tenant's events. */
  eventBusFor: (tenantId: string) => EventBus
  /** Service task handlers registered on every tenant's worker. */
  handlers: ServiceTaskHandler[]
  schedulerPollIntervalMs?: number
}

/**
 * Builds the background workers for one tenant: the service-task worker, the timer
 * scheduler and the timer coordinator, all bound to that tenant's schema and events.
 *
 * The set owns a dedicated store (its own connection pool) rather than borrowing one from
 * the shared LRU cache, so the pool can never be closed underneath a running worker.
 */
export function createTenantWorkers(tenantId: string, deps: TenantWorkerDeps): TenantWorkerSet {
  const store = new PostgresStateStore(deps.databaseUrl, tenantId)
  const eventBus = deps.eventBusFor(tenantId)

  const worker = new TaskWorker(store, eventBus)
  for (const handler of deps.handlers) worker.register(handler)

  const scheduler = new PostgresScheduler(store, { pollIntervalMs: deps.schedulerPollIntervalMs ?? 5_000 })
  const timers = new TimerCoordinator(store, eventBus, scheduler)

  async function stop(): Promise<void> {
    worker.stop()
    timers.stop()
    await scheduler.stop()
    await store.end()
  }

  return {
    async start() {
      try {
        worker.start()
        timers.start()
        await scheduler.start()
      } catch (err) {
        // Undo the partial start, otherwise a retry would subscribe a second set of workers.
        await stop().catch(() => {})
        throw err
      }
    },
    stop,
  }
}
