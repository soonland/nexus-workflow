import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { InMemoryWebhookStore } from '../webhooks/WebhookStore.js'
import { createWebhooksRouter } from './webhooks.js'

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('webhooks HTTP API', () => {
  let store: InMemoryWebhookStore
  let app: Hono

  beforeEach(() => {
    store = new InMemoryWebhookStore()
    app = new Hono()
    app.route('/', createWebhooksRouter(() => store))
  })

  // ─── POST /webhooks ───────────────────────────────────────────────────────

  describe('POST /webhooks', () => {
    it('201: returns the created registration with id, url, events, secret, createdAt', async () => {
      const res = await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/hook', events: ['ProcessInstanceCompleted'], secret: 'my-secret' }),
        }),
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body).toHaveProperty('id')
      expect(body.url).toBe('https://example.com/hook')
      expect(body.events).toEqual(['ProcessInstanceCompleted'])
      expect(body.secret).toBe('my-secret')
      expect(body).toHaveProperty('createdAt')
    })

    it('201: events defaults to empty array when omitted', async () => {
      const res = await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/hook' }),
        }),
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.events).toEqual([])
    })

    it('201: secret is null when omitted', async () => {
      const res = await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/hook' }),
        }),
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.secret).toBeNull()
    })

    it('201: id is unique across multiple registrations', async () => {
      const post = async () =>
        app
          .fetch(
            new Request('http://localhost/webhooks', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: 'https://example.com/hook' }),
            }),
          )
          .then((r) => r.json())

      const [reg1, reg2] = await Promise.all([post(), post()])
      expect(reg1.id).not.toBe(reg2.id)
    })

    it('400: invalid URL returns 400', async () => {
      const res = await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'not-a-valid-url' }),
        }),
      )
      expect(res.status).toBe(400)
    })

    it('400: missing url field returns 400', async () => {
      const res = await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: [] }),
        }),
      )
      expect(res.status).toBe(400)
    })

    it('400: non-JSON body returns 400 with INVALID_JSON error', async () => {
      const res = await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'this is not json',
        }),
      )
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('INVALID_JSON')
    })

    it('400: events as a string instead of array returns 400', async () => {
      const res = await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/hook', events: 'all' }),
        }),
      )
      expect(res.status).toBe(400)
    })
  })

  // ─── GET /webhooks ────────────────────────────────────────────────────────

  describe('GET /webhooks', () => {
    it('200: returns empty webhooks array when none registered', async () => {
      const res = await app.fetch(new Request('http://localhost/webhooks'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('webhooks')
      expect(Array.isArray(body.webhooks)).toBe(true)
      expect(body.webhooks).toHaveLength(0)
    })

    it('200: returns registered webhooks after POST', async () => {
      await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/hook' }),
        }),
      )

      const res = await app.fetch(new Request('http://localhost/webhooks'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.webhooks).toHaveLength(1)
      expect(body.webhooks[0].url).toBe('https://example.com/hook')
    })

    it('200: returns all registered webhooks when multiple exist', async () => {
      const post = async (url: string) =>
        app.fetch(
          new Request('http://localhost/webhooks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          }),
        )

      await post('https://hook1.example.com/')
      await post('https://hook2.example.com/')

      const res = await app.fetch(new Request('http://localhost/webhooks'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.webhooks).toHaveLength(2)
      const urls = body.webhooks.map((w: { url: string }) => w.url)
      expect(urls).toContain('https://hook1.example.com/')
      expect(urls).toContain('https://hook2.example.com/')
    })

    it('200: each entry has id, url, events, secret, createdAt', async () => {
      await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/hook', events: ['ProcessInstanceCompleted'] }),
        }),
      )

      const res = await app.fetch(new Request('http://localhost/webhooks'))
      const body = await res.json()
      const entry = body.webhooks[0]
      expect(entry).toHaveProperty('id')
      expect(entry).toHaveProperty('url')
      expect(entry).toHaveProperty('events')
      expect(entry).not.toHaveProperty('secret')
      expect(entry).toHaveProperty('createdAt')
    })
  })

  // ─── DELETE /webhooks/:id ─────────────────────────────────────────────────

  describe('DELETE /webhooks/:id', () => {
    it('204: deletes an existing webhook by id', async () => {
      const postRes = await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/hook' }),
        }),
      )
      const { id } = await postRes.json()

      const deleteRes = await app.fetch(
        new Request(`http://localhost/webhooks/${id}`, { method: 'DELETE' }),
      )
      expect(deleteRes.status).toBe(204)
    })

    it('204: webhook is no longer returned by GET after deletion', async () => {
      const postRes = await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/hook' }),
        }),
      )
      const { id } = await postRes.json()

      await app.fetch(
        new Request(`http://localhost/webhooks/${id}`, { method: 'DELETE' }),
      )

      const listRes = await app.fetch(new Request('http://localhost/webhooks'))
      const body = await listRes.json()
      expect(body.webhooks).toHaveLength(0)
    })

    it('404: returns NOT_FOUND error for an unknown id', async () => {
      const res = await app.fetch(
        new Request('http://localhost/webhooks/does-not-exist', { method: 'DELETE' }),
      )
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBe('NOT_FOUND')
    })

    it('404: returns message containing the missing id', async () => {
      const res = await app.fetch(
        new Request('http://localhost/webhooks/missing-id', { method: 'DELETE' }),
      )
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.message).toContain('missing-id')
    })

    it('404: deleting an already-deleted webhook returns 404', async () => {
      const postRes = await app.fetch(
        new Request('http://localhost/webhooks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/hook' }),
        }),
      )
      const { id } = await postRes.json()

      await app.fetch(
        new Request(`http://localhost/webhooks/${id}`, { method: 'DELETE' }),
      )

      // Second delete should 404
      const res = await app.fetch(
        new Request(`http://localhost/webhooks/${id}`, { method: 'DELETE' }),
      )
      expect(res.status).toBe(404)
    })
  })
})

// ─── Tenant isolation ─────────────────────────────────────────────────────────

describe('webhooks HTTP API — tenant isolation', () => {
  function makeTenantApp() {
    const stores: Record<string, InMemoryWebhookStore> = {
      acme: new InMemoryWebhookStore(),
      globex: new InMemoryWebhookStore(),
    }
    const app = new Hono<{ Variables: { tenantId: string } }>()
    // Stand-in for the auth middleware: the tenant comes from a test header
    app.use('*', async (c, next) => {
      c.set('tenantId', c.req.header('X-Tenant')!)
      return next()
    })
    app.route('/', createWebhooksRouter((tenantId) => stores[tenantId]!))
    return app
  }

  const post = (app: Hono<{ Variables: { tenantId: string } }>, tenant: string, url: string) =>
    app.fetch(
      new Request('http://localhost/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant': tenant },
        body: JSON.stringify({ url }),
      }),
    )

  it("GET /webhooks only lists the authenticated tenant's webhooks", async () => {
    const app = makeTenantApp()
    await post(app, 'acme', 'https://acme.example.com/hook')
    await post(app, 'globex', 'https://globex.example.com/hook')

    const res = await app.fetch(new Request('http://localhost/webhooks', { headers: { 'X-Tenant': 'acme' } }))
    const body = await res.json()

    expect(body.webhooks.map((w: { url: string }) => w.url)).toEqual(['https://acme.example.com/hook'])
  })

  it("DELETE /webhooks/:id cannot remove another tenant's webhook", async () => {
    const app = makeTenantApp()
    const created = await (await post(app, 'acme', 'https://acme.example.com/hook')).json()

    const res = await app.fetch(
      new Request(`http://localhost/webhooks/${created.id}`, { method: 'DELETE', headers: { 'X-Tenant': 'globex' } }),
    )
    expect(res.status).toBe(404)

    const list = await (await app.fetch(new Request('http://localhost/webhooks', { headers: { 'X-Tenant': 'acme' } }))).json()
    expect(list.webhooks).toHaveLength(1)
  })
})
