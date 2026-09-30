import { describe, it, expect, vi } from 'vitest'
import type { ExecutionEvent } from 'nexus-workflow-core'
import { TenantEventHub } from './TenantEventHub.js'

const STARTED: ExecutionEvent = {
  type: 'ProcessInstanceStarted',
  instanceId: 'inst-1',
  definitionId: 'def-1',
  definitionVersion: 1,
}

const COMPLETED: ExecutionEvent = {
  type: 'ProcessInstanceCompleted',
  instanceId: 'inst-1',
  durationMs: 1,
}

describe('TenantEventHub', () => {
  it('delivers events published on a tenant bus to subscribeAll handlers with the tenant id', async () => {
    const hub = new TenantEventHub()
    const handler = vi.fn()
    hub.subscribeAll(handler)

    await hub.busFor('acme').publish(STARTED)

    expect(handler).toHaveBeenCalledExactlyOnceWith('acme', STARTED)
  })

  it('publishMany delivers every event in order', async () => {
    const hub = new TenantEventHub()
    const seen: string[] = []
    hub.subscribeAll((_tenantId, event) => { seen.push(event.type) })

    await hub.busFor('acme').publishMany([STARTED, COMPLETED])

    expect(seen).toEqual(['ProcessInstanceStarted', 'ProcessInstanceCompleted'])
  })

  it('a tenant bus only delivers its own tenant events to its subscribers', async () => {
    const hub = new TenantEventHub()
    const acme = vi.fn()
    const globex = vi.fn()
    hub.busFor('acme').subscribe(acme)
    hub.busFor('globex').subscribe(globex)

    await hub.busFor('acme').publish(STARTED)

    expect(acme).toHaveBeenCalledExactlyOnceWith(STARTED)
    expect(globex).not.toHaveBeenCalled()
  })

  it('subscribeToType filters by event type within the tenant', async () => {
    const hub = new TenantEventHub()
    const handler = vi.fn()
    hub.busFor('acme').subscribeToType('ProcessInstanceCompleted', handler)

    await hub.busFor('acme').publish(STARTED)
    await hub.busFor('globex').publish(COMPLETED)
    await hub.busFor('acme').publish(COMPLETED)

    expect(handler).toHaveBeenCalledExactlyOnceWith(COMPLETED)
  })

  it('unsubscribe stops delivery', async () => {
    const hub = new TenantEventHub()
    const all = vi.fn()
    const scoped = vi.fn()
    const offAll = hub.subscribeAll(all)
    const offScoped = hub.busFor('acme').subscribe(scoped)

    offAll()
    offScoped()
    await hub.busFor('acme').publish(STARTED)

    expect(all).not.toHaveBeenCalled()
    expect(scoped).not.toHaveBeenCalled()
  })

  it('returns the same bus instance for the same tenant', () => {
    const hub = new TenantEventHub()
    expect(hub.busFor('acme')).toBe(hub.busFor('acme'))
    expect(hub.busFor('acme')).not.toBe(hub.busFor('globex'))
  })

  it('rejects an invalid tenant id', () => {
    const hub = new TenantEventHub()
    expect(() => hub.busFor('bad tenant!')).toThrow(/Invalid tenantId/)
  })
})
