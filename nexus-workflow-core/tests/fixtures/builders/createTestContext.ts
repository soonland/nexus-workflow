import { InMemoryStateStore } from '../../../src/adapters/InMemoryStateStore.js'
import { InMemoryEventBus } from '../../../src/adapters/InMemoryEventBus.js'
import { InMemoryScheduler } from '../../../src/adapters/InMemoryScheduler.js'
import type { ExecutionEvent } from '../../../src/interfaces/EventBus.js'
import type { ScheduledTimer } from '../../../src/model/types.js'

export interface TestContext {
  store: InMemoryStateStore
  eventBus: InMemoryEventBus
  scheduler: InMemoryScheduler
  /** Snapshot of all events published so far */
  publishedEvents(): ExecutionEvent[]
  /** Snapshot of all pending timers */
  pendingTimers(): ScheduledTimer[]
  /** Reset all state — call in beforeEach() */
  reset(): void
}

export function createTestContext(): TestContext {
  const store = new InMemoryStateStore()
  const eventBus = new InMemoryEventBus()
  const scheduler = new InMemoryScheduler()

  return {
    store,
    eventBus,
    scheduler,
    publishedEvents: () => eventBus.getAll(),
    pendingTimers: () => scheduler.getAll(),
    reset: () => {
      store.reset()
      eventBus.reset()
      scheduler.reset()
    },
  }
}
