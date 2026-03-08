import { afterEach, expect, vi } from 'vitest'
import type { ExecutionEvent } from '../src/interfaces/EventBus.js'

// Always restore real timers after each test
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

// ─── Custom Matchers ──────────────────────────────────────────────────────────

expect.extend({
  toContainEventType(received: ExecutionEvent[], expectedType: string) {
    const found = received.some(e => e.type === expectedType)
    return {
      pass: found,
      message: () => {
        const types = received.map(e => e.type).join(', ')
        return found
          ? `Expected events NOT to contain type "${expectedType}".\nActual types: [${types}]`
          : `Expected events to contain type "${expectedType}".\nActual types: [${types}]`
      },
    }
  },

  toContainEventTypes(received: ExecutionEvent[], expectedTypes: string[]) {
    const actualTypes = received.map(e => e.type)
    const missing = expectedTypes.filter(t => !actualTypes.includes(t as ExecutionEvent['type']))
    return {
      pass: missing.length === 0,
      message: () =>
        `Expected events to contain all of [${expectedTypes.join(', ')}].\nMissing: [${missing.join(', ')}]\nActual: [${actualTypes.join(', ')}]`,
    }
  },

  toHaveEventOrder(received: ExecutionEvent[], expectedOrder: string[]) {
    const actualTypes = received.map(e => e.type)
    const indices = expectedOrder.map(t => actualTypes.indexOf(t))
    const isOrdered = indices.every((idx, i) => i === 0 || (idx !== -1 && idx > (indices[i - 1] ?? -1)))
    return {
      pass: isOrdered,
      message: () =>
        `Expected events to appear in order [${expectedOrder.join(' → ')}].\nActual order: [${actualTypes.join(' → ')}]`,
    }
  },
})

// Augment Vitest's Assertion interface
interface CustomMatchers {
  toContainEventType(type: string): void
  toContainEventTypes(types: string[]): void
  toHaveEventOrder(order: string[]): void
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion extends CustomMatchers {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}
