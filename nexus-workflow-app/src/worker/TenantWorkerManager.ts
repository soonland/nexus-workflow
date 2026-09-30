/** The background work that runs for one tenant (task worker, timers, ...). */
export interface TenantWorkerSet {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface TenantWorkerManagerOptions {
  /** Ids of the tenants that should have workers running (active tenants with a schema). */
  listActiveTenantIds: () => Promise<string[]>
  /** Builds (but does not start) the workers for one tenant. */
  createWorkers: (tenantId: string) => TenantWorkerSet
  /** How often to re-read the tenant registry. Default: 5000 ms. */
  pollIntervalMs?: number
}

/**
 * Runs one set of background workers per active tenant.
 *
 * Workers subscribe to in-process events, so they must be running *before* a tenant's
 * first event is published — otherwise that event (a service task or timer) is lost.
 * `ensure(tenantId)` is therefore called on the request path for every authenticated
 * request; `sync()` (at startup and on an interval) starts workers for tenants that
 * already have persisted work (e.g. timers after a restart) and stops workers for
 * tenants that are no longer active.
 */
export class TenantWorkerManager {
  private readonly listActiveTenantIds: () => Promise<string[]>
  private readonly createWorkers: (tenantId: string) => TenantWorkerSet
  private readonly pollIntervalMs: number
  /** A promise per tenant so concurrent ensure() calls share one start. */
  private readonly running = new Map<string, Promise<TenantWorkerSet>>()
  private timer: ReturnType<typeof setInterval> | null = null
  private syncing = false
  private stopped = false

  constructor(options: TenantWorkerManagerOptions) {
    this.listActiveTenantIds = options.listActiveTenantIds
    this.createWorkers = options.createWorkers
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000
  }

  /** Start workers for every active tenant and begin polling the registry. */
  async start(): Promise<void> {
    await this.sync()
    if (this.timer === null && !this.stopped) {
      this.timer = setInterval(() => {
        this.sync().catch(err => console.error('[tenantWorkers] sync failed:', err))
      }, this.pollIntervalMs)
    }
  }

  /** Make sure the tenant's workers are running. Rejects if they fail to start. */
  ensure(tenantId: string): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('TenantWorkerManager is stopped'))

    let starting = this.running.get(tenantId)
    if (!starting) {
      const workers = this.createWorkers(tenantId)
      starting = workers.start().then(() => workers)
      this.running.set(tenantId, starting)
      // A failed start must not stay cached, or the tenant could never be retried.
      starting.catch(() => {
        if (this.running.get(tenantId) === starting) this.running.delete(tenantId)
      })
    }
    return starting.then(() => undefined)
  }

  /** Reconcile running workers with the tenant registry. */
  async sync(): Promise<void> {
    if (this.syncing || this.stopped) return
    this.syncing = true
    try {
      const active = new Set(await this.listActiveTenantIds())

      await Promise.all(
        [...active].map(async (tenantId) => {
          try {
            await this.ensure(tenantId)
          } catch (err) {
            console.error(`[tenantWorkers] failed to start workers for tenant '${tenantId}':`, err)
          }
        }),
      )

      await Promise.all(
        [...this.running.keys()]
          .filter(tenantId => !active.has(tenantId))
          .map(tenantId => this.stopTenant(tenantId)),
      )
    } finally {
      this.syncing = false
    }
  }

  /** Tenants whose workers are currently running (or starting). */
  activeTenants(): string[] {
    return [...this.running.keys()]
  }

  /** Stop polling and stop every tenant's workers. */
  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    await Promise.all([...this.running.keys()].map(tenantId => this.stopTenant(tenantId)))
  }

  /**
   * Stop one tenant's workers now (e.g. because it was suspended or is about to be deleted),
   * instead of waiting for the next sync. Does nothing if the tenant has no workers running.
   */
  async remove(tenantId: string): Promise<void> {
    await this.stopTenant(tenantId)
  }

  private async stopTenant(tenantId: string): Promise<void> {
    const starting = this.running.get(tenantId)
    this.running.delete(tenantId)
    if (!starting) return
    try {
      const workers = await starting
      await workers.stop()
    } catch (err) {
      console.error(`[tenantWorkers] error stopping workers for tenant '${tenantId}':`, err)
    }
  }
}
