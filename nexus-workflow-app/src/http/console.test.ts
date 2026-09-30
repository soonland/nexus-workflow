import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { mountConsole } from './console.js'

describe('mountConsole', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'console-'))
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Console</title><div id="root"></div>')
    writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("app")')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const get = (app: Hono, path: string) => app.fetch(new Request(`http://localhost${path}`))

  it('serves index.html at /console/', async () => {
    const app = new Hono()
    expect(mountConsole(app, dir)).toBe(true)

    const res = await get(app, '/console/')

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>Console</title>')
  })

  it('serves built assets from under /console/', async () => {
    const app = new Hono()
    mountConsole(app, dir)

    const res = await get(app, '/console/assets/app.js')

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('console.log("app")')
    expect(res.headers.get('content-type')).toContain('javascript')
  })

  it('falls back to index.html for client-side routes', async () => {
    const app = new Hono()
    mountConsole(app, dir)

    const res = await get(app, '/console/tenants/acme')

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<title>Console</title>')
  })

  it('redirects /console to /console/', async () => {
    const app = new Hono()
    mountConsole(app, dir)

    const res = await get(app, '/console')

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/console/')
  })

  it('does not mount anything, and leaves the API alone, when the console has not been built', async () => {
    const app = new Hono()
    app.get('/health', (c) => c.json({ status: 'ok' }))

    expect(mountConsole(app, join(dir, 'does-not-exist'))).toBe(false)

    expect((await get(app, '/console/')).status).toBe(404)
    expect((await get(app, '/health')).status).toBe(200)
  })

  it('does not serve files outside the console directory', async () => {
    writeFileSync(join(dir, '..', 'secret-outside.txt'), 'top secret')
    const app = new Hono()
    mountConsole(app, dir)

    const res = await get(app, '/console/..%2Fsecret-outside.txt')

    expect(await res.text()).not.toContain('top secret')
    rmSync(join(dir, '..', 'secret-outside.txt'), { force: true })
  })
})
