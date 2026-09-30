import { describe, it, expect, vi } from 'vitest'
import { TenantResourceCache } from './TenantResourceCache.js'

function makeResource(id: string) {
  return { id, end: vi.fn().mockResolvedValue(undefined) }
}

describe('TenantResourceCache', () => {
  it('creates a resource once per tenant and reuses it', () => {
    const create = vi.fn(makeResource)
    const cache = new TenantResourceCache(create)

    expect(cache.get('a')).toBe(cache.get('a'))
    expect(create).toHaveBeenCalledTimes(1)
    expect(cache.get('b')).not.toBe(cache.get('a'))
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('evicts and closes the least recently used resource when full', () => {
    const cache = new TenantResourceCache(makeResource, 2)
    const a = cache.get('a')
    const b = cache.get('b')
    cache.get('a') // 'b' is now the least recently used

    cache.get('c')

    expect(b.end).toHaveBeenCalledOnce()
    expect(a.end).not.toHaveBeenCalled()
  })

  it('evict closes and forgets one tenant, and a later get creates a fresh resource', async () => {
    const create = vi.fn(makeResource)
    const cache = new TenantResourceCache(create)
    const a = cache.get('a')
    const b = cache.get('b')

    await cache.evict('a')

    expect(a.end).toHaveBeenCalledOnce()
    expect(b.end).not.toHaveBeenCalled()
    expect(cache.get('a')).not.toBe(a)
    await cache.evict('unknown') // no-op
  })

  it('endAll closes every resource and empties the cache', async () => {
    const create = vi.fn(makeResource)
    const cache = new TenantResourceCache(create)
    const a = cache.get('a')
    const b = cache.get('b')

    await cache.endAll()

    expect(a.end).toHaveBeenCalledOnce()
    expect(b.end).toHaveBeenCalledOnce()
    cache.get('a')
    expect(create).toHaveBeenCalledTimes(3)
  })

  it('works with resources that have no end()', async () => {
    const cache = new TenantResourceCache((id) => ({ id }), 1)
    cache.get('a')
    expect(() => cache.get('b')).not.toThrow()
    await expect(cache.endAll()).resolves.toBeUndefined()
  })
})
