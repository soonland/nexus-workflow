import type { EventBus, ExecutionEvent, ExecutionEventHandler, ExecutionEventType, Unsubscribe } from 'nexus-workflow-core'
import { VALID_TENANT_ID } from '../db/tenantProvisioner.js'

/** Handler that receives an event together with the tenant that produced it. */
export type TenantEventHandler = (tenantId: string, event: ExecutionEvent) => void | Promise<void>

/** Anything that can deliver every tenant's events, tagged with the tenant id. */
export interface TenantEventSource {
  subscribeAll(handler: TenantEventHandler): Unsubscribe
}

/**
 * Event hub that keeps track of which tenant every event belongs to.
 *
 * The core engine's EventBus carries bare events with no tenant. Publishers
 * (HTTP routers, workers) get a tenant-scoped bus from `busFor(tenantId)`; every event
 * published on it reaches the `subscribeAll` handlers tagged with that tenant id. That is
 * how tenant-owned sinks (event log, webhooks, Redis stream) know where an event belongs.
 */
export class TenantEventHub implements TenantEventSource {
  private handlers: TenantEventHandler[] = []
  private readonly buses = new Map<string, TenantScopedEventBus>()

  /** Bus for one tenant. Subscribers on it only see that tenant's events. */
  busFor(tenantId: string): EventBus {
    let bus = this.buses.get(tenantId)
    if (!bus) {
      if (!VALID_TENANT_ID.test(tenantId)) {
        throw new Error(`Invalid tenantId: "${tenantId}". Only alphanumeric characters, hyphens, and underscores are allowed.`)
      }
      bus = new TenantScopedEventBus(this, tenantId)
      this.buses.set(tenantId, bus)
    }
    return bus
  }

  subscribeAll(handler: TenantEventHandler): Unsubscribe {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler)
    }
  }

  /** @internal Called by the tenant-scoped buses. */
  async publish(tenantId: string, event: ExecutionEvent): Promise<void> {
    for (const handler of this.handlers) {
      await handler(tenantId, event)
    }
  }
}

class TenantScopedEventBus implements EventBus {
  constructor(
    private readonly hub: TenantEventHub,
    private readonly tenantId: string,
  ) {}

  publish(event: ExecutionEvent): Promise<void> {
    return this.hub.publish(this.tenantId, event)
  }

  async publishMany(events: ExecutionEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event)
    }
  }

  subscribe(handler: ExecutionEventHandler): Unsubscribe {
    return this.hub.subscribeAll(async (tenantId, event) => {
      if (tenantId === this.tenantId) await handler(event)
    })
  }

  subscribeToType<T extends ExecutionEventType>(
    type: T,
    handler: (event: Extract<ExecutionEvent, { type: T }>) => void | Promise<void>,
  ): Unsubscribe {
    return this.subscribe(async (event) => {
      if (event.type === type) await handler(event as Extract<ExecutionEvent, { type: T }>)
    })
  }
}
