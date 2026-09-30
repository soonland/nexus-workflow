import { Redis } from 'ioredis'
import type { ExecutionEvent } from 'nexus-workflow-core'
import type { TenantEventSource } from './TenantEventHub.js'

export const STREAM_KEY = 'nexus:workflow:events'

export class RedisStreamPublisher {
  private readonly redis: InstanceType<typeof Redis>

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, { lazyConnect: true })
  }

  async connect(): Promise<void> {
    await this.redis.connect()
    console.log('[RedisStreamPublisher] connected')
  }

  async disconnect(): Promise<void> {
    await this.redis.quit()
  }

  /**
   * Publishes every tenant's events to the shared stream. Each entry carries a `tenantId`
   * field so consumers can tell which tenant an event belongs to.
   */
  attach(source: TenantEventSource): void {
    source.subscribeAll((tenantId, event) => { void this.publish(tenantId, event) })
  }

  private async publish(tenantId: string, event: ExecutionEvent): Promise<void> {
    try {
      await this.redis.xadd(STREAM_KEY, '*', 'type', event.type, 'data', JSON.stringify(event), 'tenantId', tenantId)
    } catch (err) {
      console.error('[RedisStreamPublisher] failed to publish event:', err)
    }
  }
}
