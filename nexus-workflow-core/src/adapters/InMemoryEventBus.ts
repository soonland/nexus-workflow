import type { ExecutionEvent, ExecutionEventHandler, ExecutionEventType, EventBus, Unsubscribe } from '../interfaces/EventBus.js'

export class InMemoryEventBus implements EventBus {
  private handlers: ExecutionEventHandler[] = []
  private published: ExecutionEvent[] = []

  async publish(event: ExecutionEvent): Promise<void> {
    this.published.push(event)
    for (const handler of this.handlers) {
      await handler(event)
    }
  }

  async publishMany(events: ExecutionEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event)
    }
  }

  subscribe(handler: ExecutionEventHandler): Unsubscribe {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter(h => h !== handler)
    }
  }

  subscribeToType<T extends ExecutionEventType>(
    type: T,
    handler: (event: Extract<ExecutionEvent, { type: T }>) => void | Promise<void>,
  ): Unsubscribe {
    const wrapper: ExecutionEventHandler = (event) => {
      if (event.type === type) {
        return handler(event as Extract<ExecutionEvent, { type: T }>)
      }
    }
    return this.subscribe(wrapper)
  }

  // ─── Test Helpers ────────────────────────────────────────────────────────────

  /** All events published so far. */
  getAll(): ExecutionEvent[] {
    return [...this.published]
  }

  /** Events of a specific type. */
  getByType<T extends ExecutionEventType>(type: T): Extract<ExecutionEvent, { type: T }>[] {
    return this.published.filter(e => e.type === type) as Extract<ExecutionEvent, { type: T }>[]
  }

  /** Reset published event log — useful in beforeEach(). */
  reset(): void {
    this.published = []
  }

  /** Clear both handlers and event log. */
  clear(): void {
    this.handlers = []
    this.published = []
  }
}
