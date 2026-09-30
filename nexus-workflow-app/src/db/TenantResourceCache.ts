/**
 * Bounded, least-recently-used cache of per-tenant resources (typically objects that own
 * a postgres.js pool). When the limit is reached the oldest entry is evicted and closed.
 */
export class TenantResourceCache<T extends { end?(): Promise<void> }> {
  private readonly entries = new Map<string, T>()

  constructor(
    private readonly create: (tenantId: string) => T,
    private readonly maxSize = 100,
  ) {}

  get(tenantId: string): T {
    const existing = this.entries.get(tenantId)
    if (existing) {
      // Refresh insertion order so this tenant stays "recently used"
      this.entries.delete(tenantId)
      this.entries.set(tenantId, existing)
      return existing
    }
    if (this.entries.size >= this.maxSize) {
      const [oldestId, oldest] = this.entries.entries().next().value as [string, T]
      this.entries.delete(oldestId)
      void oldest.end?.()
    }
    const created = this.create(tenantId)
    this.entries.set(tenantId, created)
    return created
  }

  /** Close and forget one tenant's resource (e.g. when the tenant is suspended or deleted). */
  async evict(tenantId: string): Promise<void> {
    const resource = this.entries.get(tenantId)
    if (!resource) return
    this.entries.delete(tenantId)
    await resource.end?.()
  }

  /** Close every cached resource (used on shutdown). */
  async endAll(): Promise<void> {
    for (const resource of this.entries.values()) {
      await resource.end?.()
    }
    this.entries.clear()
  }
}
