import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { clientIp } from './sessionCookie.js'

async function ipFor(headers: Record<string, string>, trustedProxies: number): Promise<string> {
  const app = new Hono()
  app.get('/', (c) => c.text(clientIp(c, trustedProxies)))
  const res = await app.fetch(new Request('http://localhost/', { headers }))
  return res.text()
}

describe('clientIp', () => {
  it('ignores X-Forwarded-For when no proxy is trusted (anyone can send that header)', async () => {
    expect(await ipFor({ 'X-Forwarded-For': '198.51.100.9' }, 0)).toBe('unknown')
  })

  it('with one trusted proxy, uses the last entry: the address that proxy saw', async () => {
    expect(await ipFor({ 'X-Forwarded-For': 'spoofed, 198.51.100.9' }, 1)).toBe('198.51.100.9')
  })

  it('with two trusted proxies (CDN then load balancer), skips the CDN to reach the client', async () => {
    // client -> CDN -> load balancer -> app: the balancer appends the CDN's address
    expect(await ipFor({ 'X-Forwarded-For': 'spoofed, 198.51.100.9, 203.0.113.50' }, 2)).toBe('198.51.100.9')
  })

  it('never trusts more entries than the proxies it was told about', async () => {
    // A client-sent value sits before the entries the trusted proxies added
    expect(await ipFor({ 'X-Forwarded-For': '10.0.0.1, 198.51.100.9' }, 1)).toBe('198.51.100.9')
  })

  it('falls back to the connection address when the header is missing or has fewer entries than proxies', async () => {
    expect(await ipFor({}, 1)).toBe('unknown')
    expect(await ipFor({ 'X-Forwarded-For': '198.51.100.9' }, 2)).toBe('unknown')
  })

  it('trims whitespace around entries', async () => {
    expect(await ipFor({ 'X-Forwarded-For': ' a ,  198.51.100.9  ' }, 1)).toBe('198.51.100.9')
  })
})

// ─── with a real connection address (as under the Node server) ────────────────

/** What the Node adapter provides: the socket of the connection. */
const connection = (address: string) => ({ incoming: { socket: { remoteAddress: address, remotePort: 51234, remoteFamily: 'IPv4' } } })

async function ipOnConnection(headers: Record<string, string>, trustedProxies: number, address = '10.0.0.5'): Promise<string> {
  const app = new Hono()
  app.get('/', (c) => c.text(clientIp(c, trustedProxies)))
  const res = await app.fetch(new Request('http://localhost/', { headers }), connection(address))
  return res.text()
}

describe('clientIp with a connection address', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('uses the connection address when no proxy is trusted, whatever X-Forwarded-For claims', async () => {
    expect(await ipOnConnection({ 'X-Forwarded-For': '198.51.100.9' }, 0)).toBe('10.0.0.5')
  })

  it('uses the forwarded client when proxies are trusted and they supplied enough entries', async () => {
    expect(await ipOnConnection({ 'X-Forwarded-For': 'a, 198.51.100.9' }, 1)).toBe('198.51.100.9')
  })

  it('does not fall back to the proxy\'s own address when there are fewer entries than trusted proxies', async () => {
    // TRUST_PROXY=2 but only one proxy is really in the path (or the app was reached directly):
    // the socket is then the proxy, and keying throttles on it would put every client in one bucket
    expect(await ipOnConnection({ 'X-Forwarded-For': '198.51.100.9' }, 2, '10.0.0.5')).toBe('unknown')
    expect(await ipOnConnection({}, 1, '10.0.0.5')).toBe('unknown')
  })

  it('says so once, so a misconfigured TRUST_PROXY does not go unnoticed (or flood the log)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fresh = await import('./sessionCookie.js') // a new module instance, so the "already warned" flag is clear
    const app = new Hono()
    app.get('/', (c) => c.text(fresh.clientIp(c, 2)))

    for (let i = 0; i < 3; i++) await app.fetch(new Request('http://localhost/', { headers: { 'X-Forwarded-For': '198.51.100.9' } }), connection('10.0.0.5'))

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/TRUST_PROXY/)
  })
})
