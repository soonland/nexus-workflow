import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createAuthMiddleware } from './auth.js'

function buildApp(apiKeys: string[]) {
  const app = new Hono()
  app.use('*', createAuthMiddleware(apiKeys))
  app.get('/health', (c) => c.json({ status: 'ok' }))
  app.get('/protected', (c) => c.json({ data: 'secret' }))
  return app
}

describe('auth middleware', () => {
  const VALID_KEY = 'test-key-abc'
  const OTHER_KEY = 'test-key-def'

  describe('protected routes', () => {
    it('401 when Authorization header is missing', async () => {
      const app = buildApp([VALID_KEY])
      const res = await app.fetch(new Request('http://localhost/protected'))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="nexus-workflow"')
    })

    it('401 when key is wrong', async () => {
      const app = buildApp([VALID_KEY])
      const res = await app.fetch(
        new Request('http://localhost/protected', {
          headers: { Authorization: 'Bearer wrong-key' },
        }),
      )
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="nexus-workflow"')
    })

    it('401 when Authorization scheme is not Bearer', async () => {
      const app = buildApp([VALID_KEY])
      const res = await app.fetch(
        new Request('http://localhost/protected', {
          headers: { Authorization: `Basic ${VALID_KEY}` },
        }),
      )
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="nexus-workflow"')
    })

    it('200 when key is valid', async () => {
      const app = buildApp([VALID_KEY])
      const res = await app.fetch(
        new Request('http://localhost/protected', {
          headers: { Authorization: `Bearer ${VALID_KEY}` },
        }),
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ data: 'secret' })
    })

    it('200 when one of multiple valid keys is used', async () => {
      const app = buildApp([VALID_KEY, OTHER_KEY])
      const res = await app.fetch(
        new Request('http://localhost/protected', {
          headers: { Authorization: `Bearer ${OTHER_KEY}` },
        }),
      )
      expect(res.status).toBe(200)
    })

    it('401 when API keys list is empty', async () => {
      const app = buildApp([])
      const res = await app.fetch(
        new Request('http://localhost/protected', {
          headers: { Authorization: 'Bearer any-key' },
        }),
      )
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="nexus-workflow"')
    })
  })

  describe('health bypass', () => {
    it('200 on GET /health without any auth header', async () => {
      const app = buildApp([VALID_KEY])
      const res = await app.fetch(new Request('http://localhost/health'))
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'ok' })
    })

    it('200 on GET /health even when API keys list is empty', async () => {
      const app = buildApp([])
      const res = await app.fetch(new Request('http://localhost/health'))
      expect(res.status).toBe(200)
    })
  })
})
