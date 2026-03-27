import { Hono } from 'hono'
import { z } from 'zod'
import type { WebhookStore } from '../webhooks/WebhookStore.js'
import { validationError } from './validation.js'

// ─── Schemas ──────────────────────────────────────────────────────────────────

const CreateWebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).optional(),
  secret: z.string().optional(),
})

// ─── Router ───────────────────────────────────────────────────────────────────

export function createWebhooksRouter(store: WebhookStore): Hono {
  const app = new Hono()

  // POST /webhooks — register a new webhook
  app.post('/webhooks', async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'INVALID_JSON', message: 'Request body must be valid JSON' }, 400)
    }

    const parsed = CreateWebhookSchema.safeParse(body)
    if (!parsed.success) return c.json(validationError(parsed.error), 400)

    const reg = await store.save(parsed.data)
    return c.json(reg, 201)
  })

  // GET /webhooks — list all registered webhooks (secret is omitted from responses)
  app.get('/webhooks', async (c) => {
    const registrations = await store.list()
    const safeRegistrations = registrations.map(({ secret: _s, ...r }) => r)
    return c.json({ webhooks: safeRegistrations })
  })

  // DELETE /webhooks/:id — remove a webhook
  app.delete('/webhooks/:id', async (c) => {
    const id = c.req.param('id')
    const deleted = await store.delete(id)
    if (!deleted) {
      return c.json({ error: 'NOT_FOUND', message: `Webhook '${id}' not found` }, 404)
    }
    return c.body(null, 204)
  })

  return app
}
