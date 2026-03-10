import { Redis } from 'ioredis'
import type { ExecutionEvent, EventBus } from 'nexus-workflow-core'

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

  attach(eventBus: EventBus): void {
    eventBus.subscribe((event) => { void this.publish(event) })
  }

  private async publish(event: ExecutionEvent): Promise<void> {
    try {
      await this.redis.xadd(STREAM_KEY, '*', 'type', event.type, 'data', JSON.stringify(event))
    } catch (err) {
      console.error('[RedisStreamPublisher] failed to publish event:', err)
    }
  }
}
