import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TenantWorkerManager, type TenantWorkerSet } from './TenantWorkerManager.js'

function makeSet(tenantId: string, log: string[]): TenantWorkerSet {
  return {
    start: vi.fn(async () => { log.push(`start:${tenantId}`) }),
    stop: vi.fn(async () => { log.push(`stop:${tenantId}`) }),
  }
}

describe('TenantWorkerManager', () => {
  let active: string[]
  let log: string[]
  let sets: Map<string, TenantWorkerSet>
  let createWorkers: ReturnType<typeof vi.fn>

  function makeManager(pollIntervalMs = 1_000) {
    return new TenantWorkerManager({
      listActiveTenantIds: async () => [...active],
      createWorkers: createWorkers as unknown as (tenantId: string) => TenantWorkerSet,
      pollIntervalMs,
    })
  }

  beforeEach(() => {
    active = ['default']
    log = []
    sets = new Map()
    createWorkers = vi.fn((tenantId: string) => {
      const set = makeSet(tenantId, log)
      sets.set(tenantId, set)
      return set
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('start() starts workers for every active tenant', async () => {
    active = ['default', 'acme']
    const manager = makeManager()

    await manager.start()

    expect(log.sort()).toEqual(['start:acme', 'start:default'])
    expect(manager.activeTenants().sort()).toEqual(['acme', 'default'])
    await manager.stop()
  })

  it('ensure() starts a tenant once, even when called concurrently', async () => {
    const manager = makeManager()

    await Promise.all([manager.ensure('acme'), manager.ensure('acme'), manager.ensure('acme')])
    await manager.ensure('acme')

    expect(createWorkers).toHaveBeenCalledTimes(1)
    expect(log).toEqual(['start:acme'])
    await manager.stop()
  })

  it('ensure() rejects when the workers fail to start, and a later call retries', async () => {
    const manager = makeManager()
    createWorkers.mockImplementationOnce((tenantId: string) => ({
      start: vi.fn().mockRejectedValue(new Error('boom')),
      stop: vi.fn().mockResolvedValue(undefined),
      tenantId,
    }))

    await expect(manager.ensure('acme')).rejects.toThrow('boom')
    expect(manager.activeTenants()).toEqual([])

    await manager.ensure('acme')
    expect(manager.activeTenants()).toEqual(['acme'])
    await manager.stop()
  })

  it('sync() starts newly active tenants and stops tenants that are no longer active', async () => {
    const manager = makeManager()
    await manager.start()
    log.length = 0

    active = ['default', 'acme']
    await manager.sync()
    expect(log).toEqual(['start:acme'])

    log.length = 0
    active = ['acme']
    await manager.sync()
    expect(log).toEqual(['stop:default'])
    expect(manager.activeTenants()).toEqual(['acme'])
    await manager.stop()
  })

  it('sync() keeps going when one tenant fails to start, and retries it next time', async () => {
    active = ['bad', 'good']
    createWorkers.mockImplementation((tenantId: string) => {
      const set = makeSet(tenantId, log)
      if (tenantId === 'bad' && !sets.has('bad-failed')) {
        sets.set('bad-failed', set)
        set.start = vi.fn().mockRejectedValue(new Error('schema missing'))
      }
      return set
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const manager = makeManager()

    await manager.sync()

    expect(manager.activeTenants()).toEqual(['good'])
    expect(errorSpy).toHaveBeenCalled()

    await manager.sync()
    expect(manager.activeTenants().sort()).toEqual(['bad', 'good'])
    errorSpy.mockRestore()
    await manager.stop()
  })

  it('polls the registry on an interval', async () => {
    vi.useFakeTimers()
    const manager = makeManager(1_000)
    await manager.start()
    expect(manager.activeTenants()).toEqual(['default'])

    active = ['default', 'acme']
    await vi.advanceTimersByTimeAsync(1_000)

    expect(manager.activeTenants().sort()).toEqual(['acme', 'default'])
    await manager.stop()
  })

  it('stop() stops every tenant and stops polling', async () => {
    vi.useFakeTimers()
    active = ['default', 'acme']
    const manager = makeManager(1_000)
    await manager.start()
    log.length = 0

    await manager.stop()
    expect(log.sort()).toEqual(['stop:acme', 'stop:default'])
    expect(manager.activeTenants()).toEqual([])

    active = ['default', 'acme', 'late']
    await vi.advanceTimersByTimeAsync(5_000)
    expect(createWorkers).not.toHaveBeenCalledWith('late')
  })

  it('ensure() after stop() does not start workers', async () => {
    const manager = makeManager()
    await manager.start()
    await manager.stop()

    await expect(manager.ensure('acme')).rejects.toThrow(/stopped/)
  })

  it('a poll error does not crash and is retried on the next tick', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const list = vi.fn()
      .mockResolvedValueOnce(['default'])
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(['default', 'acme'])
    const manager = new TenantWorkerManager({
      listActiveTenantIds: list,
      createWorkers: createWorkers as unknown as (tenantId: string) => TenantWorkerSet,
      pollIntervalMs: 1_000,
    })
    await manager.start()

    await vi.advanceTimersByTimeAsync(1_000) // error
    await vi.advanceTimersByTimeAsync(1_000) // recovers

    expect(errorSpy).toHaveBeenCalled()
    expect(manager.activeTenants().sort()).toEqual(['acme', 'default'])
    errorSpy.mockRestore()
    await manager.stop()
  })
})
