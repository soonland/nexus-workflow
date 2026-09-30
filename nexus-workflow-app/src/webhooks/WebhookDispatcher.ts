import { createHmac } from 'node:crypto'
import type { ExecutionEvent } from 'nexus-workflow-core'
import type { TenantEventSource } from '../events/TenantEventHub.js'
import type { WebhookStore } from './WebhookStore.js'

// ─── Options ──────────────────────────────────────────────────────────────────

export interface WebhookDispatcherOptions {
  /** Maximum delivery attempts per event/webhook pair. Default: 3. */
  maxAttempts?: number
  /** Base delay in ms for exponential backoff between retries. Default: 1000. */
  baseRetryDelayMs?: number
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetch?: typeof fetch
}

// ─── WebhookDispatcher ────────────────────────────────────────────────────────

/**
 * Delivers execution events to the webhooks registered by the tenant that produced them.
 * A tenant's events are never sent to another tenant's webhooks.
 */
export class WebhookDispatcher {
  private readonly storeFor: (tenantId: string) => WebhookStore
  private readonly source: TenantEventSource
  private readonly maxAttempts: number
  private readonly baseRetryDelayMs: number
  private readonly fetch: typeof fetch
  private unsubscribe: (() => void) | null = null
  private stopped = false

  constructor(
    storeFor: (tenantId: string) => WebhookStore,
    source: TenantEventSource,
    options: WebhookDispatcherOptions = {},
  ) {
    this.storeFor = storeFor
    this.source = source
    this.maxAttempts = options.maxAttempts ?? 3
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 1000
    this.fetch = options.fetch ?? globalThis.fetch
  }

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.source.subscribeAll((tenantId, event) => {
      void this.dispatch(tenantId, event)
    })
  }

  stop(): void {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async dispatch(tenantId: string, event: ExecutionEvent): Promise<void> {
    let registrations
    try {
      registrations = await this.storeFor(tenantId).list()
    } catch (err) {
      console.error(`[webhook] failed to load registrations for tenant '${tenantId}':`, err)
      return
    }

    const body = JSON.stringify({ event })

    for (const reg of registrations) {
      if (!this.matches(reg.events, event.type)) continue
      void this.deliver(reg.url, reg.secret, event.type, body, 1)
    }
  }

  private matches(filter: string[], eventType: string): boolean {
    return filter.length === 0 || filter.includes(eventType)
  }

  private async deliver(
    url: string,
    secret: string | null,
    eventType: string,
    body: string,
    attempt: number,
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Nexus-Event': eventType,
    }

    if (secret) {
      const sig = createHmac('sha256', secret).update(body).digest('hex')
      headers['X-Nexus-Signature'] = `sha256=${sig}`
    }

    let ok = false
    try {
      const res = await this.fetch(url, { method: 'POST', headers, body })
      ok = res.ok
      if (!ok) {
        console.warn(`[webhook] delivery to ${url} failed with status ${res.status} (attempt ${attempt}/${this.maxAttempts})`)
      }
    } catch (err) {
      console.warn(`[webhook] delivery to ${url} threw (attempt ${attempt}/${this.maxAttempts}):`, err)
    }

    if (!this.stopped && !ok && attempt < this.maxAttempts) {
      const delay = this.baseRetryDelayMs * Math.pow(2, attempt - 1)
      setTimeout(() => {
        void this.deliver(url, secret, eventType, body, attempt + 1)
      }, delay)
    } else if (!ok) {
      console.error(`[webhook] giving up delivery to ${url} after ${this.maxAttempts} attempts`)
    }
  }
}

// ─── Exported helper for signature verification ───────────────────────────────

export function computeSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}
