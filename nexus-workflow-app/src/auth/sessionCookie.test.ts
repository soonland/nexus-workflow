import { describe, it, expect } from 'vitest'
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
